import { fileURLToPath } from "node:url"

import { normalizeParityTrace, ObservableEventSchema } from "@agentic-chat/contracts"
import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"
import { TestWorkflowEnvironment } from "@temporalio/testing"
import { Worker } from "@temporalio/worker"

import { createAdmissionService } from "../src/application/index.js"
import { createScriptedProvider } from "../src/provider/index.js"
import { createStateWorkflowActivities } from "../src/state-workflow/activities.js"
import { createStateWorkflowActivityAdapter } from "../src/state-workflow/activity-adapter.js"
import { STATE_WORKFLOW_START_POLICIES } from "../src/state-workflow/client.js"
import type { StateWorkflowActivities } from "../src/state-workflow/contracts.js"
import { stateWorkflow } from "../src/state-workflow/workflows.js"
import type { ApplicationTestContext } from "./application-support.js"
import { createOwnedConversation, createTestIds, testClock } from "./application-support.js"
import type { SimpleLoopScenario } from "./simple-loop-support.js"
import { readRunEvidence } from "./simple-loop-support.js"

type ExecuteStateWorkflowOptions = {
  readonly failAfterAdvanceCommitOnce?: boolean
}

export type StateWorkflowTestEnvironment = TestWorkflowEnvironment

export const startStateWorkflowTestEnvironment = (): Promise<StateWorkflowTestEnvironment> =>
  TestWorkflowEnvironment.createLocal()

export const normalizeStateWorkflowEvidence = (
  runId: string,
  events: readonly {
    readonly type: string
    readonly visibility: "user" | "admin" | "model_only" | "internal"
    readonly payload: unknown
  }[],
) =>
  normalizeParityTrace(
    events.map((event, index) =>
      ObservableEventSchema.parse({
        eventId: `event_${index + 1}`,
        runId,
        sequence: index + 1,
        type: event.type,
        visibility: event.visibility,
        payload: event.payload,
        correlationId: `correlation_${index + 1}`,
        occurredAt: "2026-08-16T12:00:00.000Z",
      }),
    ),
  )

export const executeStateWorkflowScenario = async (
  context: ApplicationTestContext,
  environment: TestWorkflowEnvironment,
  scenario: SimpleLoopScenario,
  options: ExecuteStateWorkflowOptions = {},
) => {
  const namespace = scenario.namespace
  const ids = createTestIds(namespace)
  await createOwnedConversation(context, `conversation_${namespace}`)
  const receipt = await createAdmissionService({
    database: context.database,
    clock: testClock,
    ids,
  }).admit({
    commandId: `command_${namespace}`,
    createdAt: testClock.now().toISOString(),
    type: "chat.send_message",
    actorId: "mvp_user",
    payload: {
      kind: "new_run",
      conversationId: `conversation_${namespace}`,
      runtime: "state_workflow",
      message: scenario.prompt,
      idempotencyKey: `idempotency_${namespace}`,
    },
  })
  const pending = await context.database.pool.query<{ readonly id: string }>(
    "select id from dispatch_intents where aggregate_id = $1 and topic = 'state_workflow.start'",
    [receipt.runId],
  )
  const intentId = pending.rows[0]?.id
  if (intentId === undefined) throw new TypeError(`Missing workflow intent for ${receipt.runId}`)
  const ledger = createInvocationLedger()
  let providerInvocations = 0
  const scripted = createScriptedProvider(scenario.script)
  const adapter = createStateWorkflowActivityAdapter({
    database: context.database,
    clock: testClock,
    provider: {
      generate: async (input) => {
        providerInvocations += 1
        return scripted.generate(input)
      },
    },
    tools: createToolRegistry({ ledger }),
    timeoutMs: 1_000,
  })
  const baseActivities = createStateWorkflowActivities(adapter)
  let advanceAttempts = 0
  const activities: StateWorkflowActivities = {
    ...baseActivities,
    advanceRun: async (input) => {
      advanceAttempts += 1
      const directive = await baseActivities.advanceRun(input)
      if (options.failAfterAdvanceCommitOnce === true && advanceAttempts === 1) {
        throw new TypeError("injected post-commit Activity timeout")
      }
      return directive
    },
  }
  const taskQueue = `state-workflow-${namespace}`
  const workflowsPath = fileURLToPath(
    new URL("../src/state-workflow/workflows.ts", import.meta.url),
  )
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    ...(environment.namespace ? { namespace: environment.namespace } : {}),
    taskQueue,
    workflowsPath,
    activities,
  })
  const workerRun = worker.run()
  const workflowId = `agent-run/${receipt.runId}`
  try {
    const handle = await environment.client.workflow.start(stateWorkflow, {
      workflowId,
      taskQueue,
      args: [{ workflowId, runId: receipt.runId, intentId }],
      ...STATE_WORKFLOW_START_POLICIES,
    })
    const workflowResult = await handle.result()
    const evidence = await readRunEvidence(context, receipt.runId)
    return { receipt, workflowResult, evidence, ledger, providerInvocations, advanceAttempts }
  } finally {
    worker.shutdown()
    await workerRun
  }
}
