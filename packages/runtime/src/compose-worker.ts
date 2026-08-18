import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { createDatabase, listPendingDispatches } from "@agentic-chat/db"
import { createToolRegistry } from "@agentic-chat/tools"
import { Connection, WorkflowClient } from "@temporalio/client"
import { NativeConnection } from "@temporalio/worker"
import { z } from "zod"
import { secureIds, systemClock } from "./application/dependencies.js"
import { createReconciliationService } from "./application/reconciliation.js"
import { handleSimpleLoopDispatch } from "./compose-simple-dispatch.js"
import { parseEnvironment, providerRequestTimeoutMs } from "./environment.js"
import { createBullReportQueue, createReportFixtureTestWorker } from "./jobs/report-queue.js"
import type { ModelProvider } from "./provider/contracts.js"
import { createComposeProvider } from "./provider/factory.js"
import { createSimpleLoopRuntime } from "./simple-loop/runtime.js"
import { createSimpleLoopWorker } from "./simple-loop/worker.js"
import { createStateWorkflowActivities } from "./state-workflow/activities.js"
import { createStateWorkflowActivityAdapter } from "./state-workflow/activity-adapter.js"
import { createTemporalWorkflowStarter, reconcileWorkflowStarts } from "./state-workflow/client.js"
import { reconcileStateWorkflowSignals } from "./state-workflow/signal-reconciliation.js"
import { createStateWorkflowWorker, STATE_WORKFLOW_TASK_QUEUE } from "./state-workflow/worker.js"

const roleSchema = z.enum(["simple_loop", "state_workflow", "fixture_jobs"])
const environmentSchema = z.looseObject({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  TEMPORAL_ADDRESS: z.string().min(1),
})
const task18EnvironmentSchema = z.looseObject({
  NODE_ENV: z.literal("test"),
  TASK18_COMPOSE_MODE: z.literal("enabled"),
})
const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))

const runSimpleWorker = async (
  environment: z.infer<typeof environmentSchema>,
  provider: ModelProvider,
  timeoutMs: number,
): Promise<void> => {
  const database = createDatabase(environment.DATABASE_URL)
  const reportQueue = createBullReportQueue({ redisUrl: environment.REDIS_URL })
  const runtime = createSimpleLoopRuntime({
    database,
    clock: systemClock,
    ids: secureIds,
    provider,
    tools: createToolRegistry(),
    timeoutMs,
    durableWaits: { namespace: "task18-compose", reportQueue },
  })
  const owner = `compose-simple-${process.pid}-${Date.now()}`
  const worker = createSimpleLoopWorker(runtime, { owner, durationSeconds: 30 })
  let stopping = false
  process.once("SIGTERM", () => {
    stopping = true
  })
  await writeFile("/run/agentic-chat/worker-ready", "simple_loop\n")
  console.log(JSON.stringify({ event: "worker.ready", role: "simple_loop", owner }))
  while (!stopping) {
    for (const intent of await listPendingDispatches(database)) {
      if (intent.topic !== "simple_loop.execute") continue
      try {
        const result = await handleSimpleLoopDispatch({
          database,
          executor: worker,
          intent,
          handledAt: new Date(),
        })
        console.log(
          JSON.stringify({ event: "simple.execute", owner, intentId: intent.intentId, result }),
        )
      } catch (error) {
        if (!(error instanceof Error)) throw error
        console.log(
          JSON.stringify({
            event: "simple.conflict",
            owner,
            intentId: intent.intentId,
            message: error.message,
          }),
        )
      }
    }
    await delay()
  }
  await reportQueue.close()
  await database.close()
}

const runWorkflowWorker = async (
  environment: z.infer<typeof environmentSchema>,
  provider: ModelProvider,
  timeoutMs: number,
): Promise<void> => {
  const database = createDatabase(environment.DATABASE_URL)
  const reportQueue = createBullReportQueue({ redisUrl: environment.REDIS_URL })
  const nativeConnection = await NativeConnection.connect({ address: environment.TEMPORAL_ADDRESS })
  const clientConnection = await Connection.connect({ address: environment.TEMPORAL_ADDRESS })
  const workflowClient = new WorkflowClient({ connection: clientConnection })
  const adapter = createStateWorkflowActivityAdapter({
    database,
    clock: systemClock,
    provider,
    tools: createToolRegistry(),
    timeoutMs,
    durableWaits: { namespace: "task18-compose", reportQueue },
  })
  const worker = await createStateWorkflowWorker({
    connection: nativeConnection,
    namespace: "default",
    workflowsPath: fileURLToPath(new URL("./state-workflow/workflows.js", import.meta.url)),
    activities: createStateWorkflowActivities(adapter),
  })
  const workerRun = worker.run()
  let stopping = false
  process.once("SIGTERM", () => {
    stopping = true
    worker.shutdown()
  })
  await writeFile("/run/agentic-chat/worker-ready", "state_workflow\n")
  console.log(JSON.stringify({ event: "worker.ready", role: "state_workflow" }))
  const source = createReconciliationService(database)
  const starter = createTemporalWorkflowStarter({
    workflowClient,
    taskQueue: STATE_WORKFLOW_TASK_QUEUE,
  })
  while (!stopping) {
    const starts = await reconcileWorkflowStarts({ source, starter })
    const signals = await reconcileStateWorkflowSignals({
      database,
      workflowClient,
      clock: systemClock,
    })
    if (starts.started + starts.existing + signals.signaled > 0) {
      console.log(JSON.stringify({ event: "workflow.reconcile", starts, signals }))
    }
    await delay()
  }
  await workerRun
  await Promise.all([
    reportQueue.close(),
    database.close(),
    nativeConnection.close(),
    clientConnection.close(),
  ])
}

const runFixtureWorker = async (environment: z.infer<typeof environmentSchema>): Promise<void> => {
  const database = createDatabase(environment.DATABASE_URL)
  const controls = {
    beforeCompletion: async (): Promise<void> => {
      for (;;) {
        const released = await database.pool.query<{ readonly released: boolean }>(
          "select not exists(select 1 from dispatch_intents where topic = 'task18.fixture.hold' and status = 'pending') released",
        )
        if (released.rows[0]?.released === true) return
        await delay()
      }
    },
    takeCrashAfterProgress: (): boolean => false,
    duplicateDelivery: true,
    afterCompleted: async (): Promise<void> => {},
  }
  const worker = createReportFixtureTestWorker({
    redisUrl: environment.REDIS_URL,
    database,
    clock: systemClock,
    controls,
  })
  await worker.waitUntilReady()
  await writeFile("/run/agentic-chat/worker-ready", "fixture_jobs\n")
  console.log(JSON.stringify({ event: "worker.ready", role: "fixture_jobs" }))
  await new Promise<void>((resolve) => process.once("SIGTERM", resolve))
  await worker.close()
  await database.close()
}

const role = roleSchema.parse(process.argv[2])
const environment = environmentSchema.parse(process.env)
switch (role) {
  case "simple_loop": {
    const providerConfiguration = parseEnvironment(process.env)
    if (providerConfiguration.mode === "mock") task18EnvironmentSchema.parse(process.env)
    await runSimpleWorker(
      environment,
      createComposeProvider(providerConfiguration),
      providerRequestTimeoutMs(providerConfiguration),
    )
    break
  }
  case "state_workflow": {
    const providerConfiguration = parseEnvironment(process.env)
    if (providerConfiguration.mode === "mock") task18EnvironmentSchema.parse(process.env)
    await runWorkflowWorker(
      environment,
      createComposeProvider(providerConfiguration),
      providerRequestTimeoutMs(providerConfiguration),
    )
    break
  }
  case "fixture_jobs":
    task18EnvironmentSchema.parse(process.env)
    await runFixtureWorker(environment)
    break
  default: {
    const exhaustiveRole: never = role
    throw new TypeError(`Unsupported role ${exhaustiveRole}`)
  }
}
