import { fileURLToPath } from "node:url"

import { CallIdSchema, PreviewIdSchema, parseContract } from "@agentic-chat/contracts"
import {
  claimNextSimpleLoopRun,
  completeReportJob,
  consumeStateWorkflowStep,
  createConversation,
  persistStateWorkflowUserWait,
  readApprovalSnapshot,
  recordReportProgress,
} from "@agentic-chat/db"
import { captureAcceptanceFromEnvironment } from "@agentic-chat/testkit"
import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"
import { TestWorkflowEnvironment } from "@temporalio/testing"
import { Worker } from "@temporalio/worker"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"

import {
  createAdminCommandService,
  createAdmissionService,
  createApprovalService,
} from "../src/application/index.js"
import type { ReportJobQueue } from "../src/application/report-jobs.js"
import { type ProviderRequest, ProviderRequestSchema } from "../src/provider/contracts.js"
import { createScriptedProvider, type ScriptedProviderStep } from "../src/provider/index.js"
import { createStateWorkflowActivities } from "../src/state-workflow/activities.js"
import { createStateWorkflowActivityAdapter } from "../src/state-workflow/activity-adapter.js"
import { STATE_WORKFLOW_START_POLICIES } from "../src/state-workflow/client.js"
import { StateWorkflowContextSchema } from "../src/state-workflow/context.js"
import { reconcileStateWorkflowSignals } from "../src/state-workflow/signal-reconciliation.js"
import {
  adminDecisionSignal,
  inspectStateQuery,
  jobCompletionSignal,
  stateWorkflow,
} from "../src/state-workflow/workflows.js"
import type { ApplicationTestContext } from "./application-support.js"
import {
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"
import { readRunEvidence } from "./simple-loop-support.js"

class RecordingQueue implements ReportJobQueue {
  readonly payloads: Parameters<ReportJobQueue["enqueue"]>[0][] = []

  async enqueue(payload: Parameters<ReportJobQueue["enqueue"]>[0]): Promise<void> {
    this.payloads.push(payload)
  }
}

describe("State Workflow F06-F10 durable recovery", () => {
  let context: ApplicationTestContext
  let environment: TestWorkflowEnvironment
  const workflowsPath = fileURLToPath(
    new URL("../src/state-workflow/workflows.ts", import.meta.url),
  )

  beforeAll(async () => {
    ;[context, environment] = await Promise.all([
      startApplicationTestContext(),
      TestWorkflowEnvironment.createLocal(),
    ])
  }, 120_000)

  afterAll(async () => {
    await Promise.all([stopApplicationTestContext(context), environment.teardown()])
  })

  const admit = async (namespace: string, message: string) => {
    const ids = createTestIds(namespace)
    await createConversation(context.database, {
      conversationId: `conversation_${namespace}`,
      userId: "mvp_user",
      now: testClock.now(),
    })
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
        message,
        idempotencyKey: `idempotency_${namespace}`,
      },
    })
    const intents = await context.database.pool.query<{ readonly id: string }>(
      "select id from dispatch_intents where aggregate_id = $1 and topic = 'state_workflow.start'",
      [receipt.runId],
    )
    const intentId = intents.rows[0]?.id
    if (intentId === undefined) throw new TypeError("Expected State Workflow start intent")
    return { ids, receipt, intentId, workflowId: `agent-run/${receipt.runId}` }
  }

  const startWorker = async (input: {
    readonly taskQueue: string
    readonly script: readonly ScriptedProviderStep[]
    readonly tools: ReturnType<typeof createToolRegistry>
    readonly queue: RecordingQueue
    readonly capture?: (request: ProviderRequest) => void
  }) => {
    const scripted = createScriptedProvider(input.script)
    const adapter = createStateWorkflowActivityAdapter({
      database: context.database,
      clock: testClock,
      provider: {
        generate: async (request) => {
          const parsed = ProviderRequestSchema.parse(request)
          input.capture?.(parsed)
          return scripted.generate(parsed)
        },
      },
      tools: input.tools,
      timeoutMs: 1_000,
      durableWaits: { namespace: "state-workflow-durable", reportQueue: input.queue },
    })
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace ? { namespace: environment.namespace } : {}),
      taskQueue: input.taskQueue,
      workflowsPath,
      activities: createStateWorkflowActivities(adapter),
    })
    return { worker, run: worker.run() }
  }

  const stopWorker = async (active: Awaited<ReturnType<typeof startWorker>>): Promise<void> => {
    active.worker.shutdown()
    await active.run
  }

  it("F06/F10 resumes one canonical report after a real Temporal worker restart", async () => {
    // Given: the first worker persists a report wait and stable queue identity.
    const admitted = await admit("state_durable_report", "Generate the quarterly report.")
    const queue = new RecordingQueue()
    const tools = createToolRegistry({ ledger: createInvocationLedger() })
    const taskQueue = "state-durable-report"
    const first = await startWorker({
      taskQueue,
      queue,
      tools,
      script: [
        {
          kind: "skill_load",
          callId: parseContract(CallIdSchema, "call_skill_state_durable_report"),
          skillId: "report_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: parseContract(CallIdSchema, "call_report_state_durable_report"),
              toolName: "report.generate",
              arguments: { topic: "quarterly", sections: ["summary"] },
            },
          ],
        },
      ],
    })
    const handle = await environment.client.workflow.start(stateWorkflow, {
      workflowId: admitted.workflowId,
      taskQueue,
      args: [
        {
          workflowId: admitted.workflowId,
          runId: admitted.receipt.runId,
          intentId: admitted.intentId,
        },
      ],
      ...STATE_WORKFLOW_START_POLICIES,
    })
    await expect
      .poll(() => handle.query(inspectStateQuery))
      .toMatchObject({
        status: "waiting_for_tool",
        wait: { kind: "job", callId: "call_report_state_durable_report", jobId: "job_001" },
      })
    const waitingState = await handle.query(inspectStateQuery)
    await handle.signal(jobCompletionSignal, {
      kind: "job_completion",
      runId: "run_cross_scope",
      callId: "call_report_state_durable_report",
      jobId: "job_001",
      outcome: "completed",
    })
    expect(await handle.query(inspectStateQuery)).toEqual(waitingState)
    await stopWorker(first)

    // When: PostgreSQL completes the accepted job and reconciliation signals while no worker polls.
    const payload = queue.payloads[0]
    if (payload === undefined) throw new TypeError("Expected report queue payload")
    await recordReportProgress(context.database, {
      ledgerKey: payload.ledgerKey,
      eventId: "job_event_state_durable_progress",
      runEventId: "run_event_state_durable_progress",
      occurredAt: testClock.now(),
    })
    await completeReportJob(context.database, {
      ledgerKey: payload.ledgerKey,
      eventId: "job_event_state_durable_complete",
      runEventId: "run_event_state_durable_complete",
      reportId: payload.reportId,
      occurredAt: testClock.now(),
    })
    expect(
      await reconcileStateWorkflowSignals({
        database: context.database,
        workflowClient: environment.client.workflow,
        clock: testClock,
      }),
    ).toEqual({ signaled: 1 })
    await handle.signal(jobCompletionSignal, {
      kind: "job_completion",
      runId: admitted.receipt.runId,
      callId: payload.callId,
      jobId: payload.jobId,
      outcome: "completed",
    })
    const restarted = await startWorker({
      taskQueue,
      queue,
      tools,
      script: [{ kind: "text", text: "Report report_001 is complete." }],
    })
    const result = await handle.result()
    await stopWorker(restarted)
    const evidence = await readRunEvidence(context, admitted.receipt.runId)

    // Then: one report result and one final message survive duplicate wakeups with stable IDs.
    expect(result).toMatchObject({ status: "completed" })
    expect(queue.payloads).toHaveLength(1)
    expect(evidence.calls).toEqual([
      expect.objectContaining({ tool_id: "report.generate", status: "completed" }),
    ])
    expect(evidence.messages.filter((message) => message.actor === "ai")).toHaveLength(1)
    expect(
      await claimNextSimpleLoopRun(context.database, { owner: "simple-zero", durationSeconds: 30 }),
    ).toBeNull()
    await captureAcceptanceFromEnvironment(context.database, {
      runId: admitted.receipt.runId,
      fixtureNamespace: "state_durable_report",
      runtimeDiagnostics: [{ waitingState, taskQueue, queuePayloads: queue.payloads.length }],
      executionOutcome: result,
    })
  }, 120_000)

  it.each([
    { decision: "approve" as const, canonical: "approved" as const, expectedSends: 1 },
    { decision: "reject" as const, canonical: "rejected" as const, expectedSends: 0 },
  ])(
    "F07/F08 preserves exact approval across restart after $decision",
    async ({ decision, canonical, expectedSends }) => {
      // Given: a worker reaches one exact approval-bound notification call.
      const namespace = `state_durable_${decision}`
      const admitted = await admit(namespace, "Preview and send the notification.")
      const ledger = createInvocationLedger()
      const tools = createToolRegistry({ ledger })
      const queue = new RecordingQueue()
      const taskQueue = `state-durable-${decision}`
      const first = await startWorker({
        taskQueue,
        queue,
        tools,
        script: [
          {
            kind: "skill_load",
            callId: parseContract(CallIdSchema, `call_skill_${namespace}`),
            skillId: "communication_assistant",
            version: "1",
          },
          {
            kind: "tool_calls",
            calls: [
              {
                callId: parseContract(CallIdSchema, `call_preview_${namespace}`),
                toolName: "notification.preview",
                arguments: { recipient: "qa@example.com", subject: "MVP", body: "Approval" },
              },
            ],
          },
          {
            kind: "tool_calls",
            calls: [
              {
                callId: parseContract(CallIdSchema, `call_send_${namespace}`),
                toolName: "notification.send_email",
                arguments: {
                  previewId: parseContract(PreviewIdSchema, `preview_call_preview_${namespace}`),
                },
              },
            ],
          },
        ],
      })
      const handle = await environment.client.workflow.start(stateWorkflow, {
        workflowId: admitted.workflowId,
        taskQueue,
        args: [
          {
            workflowId: admitted.workflowId,
            runId: admitted.receipt.runId,
            intentId: admitted.intentId,
          },
        ],
        ...STATE_WORKFLOW_START_POLICIES,
      })
      await expect
        .poll(() => handle.query(inspectStateQuery))
        .toMatchObject({ status: "waiting_for_admin" })
      const waiting = await handle.query(inspectStateQuery)
      if (waiting.wait?.kind !== "admin") throw new TypeError("Expected Admin wait")
      await stopWorker(first)
      const approval = await readApprovalSnapshot(context.database, {
        runId: admitted.receipt.runId,
        approvalId: waiting.wait.approvalId,
        callId: waiting.wait.callId,
      })
      if (approval === null) throw new TypeError("Expected exact approval")

      // When: Admin decides canonically, a wrong decision wakeup is ignored, and reconciliation delivers the exact signal.
      await createApprovalService({
        database: context.database,
        clock: testClock,
        ids: admitted.ids,
        tools,
      }).decide(
        { actorId: "mvp_admin" },
        {
          decision,
          approvalId: approval.approvalId,
          callId: approval.callId,
          expectedArgumentsHash: approval.argumentsHash,
          expectedVersion: approval.version,
          ...(decision === "reject" ? { reason: "MVP rejection test" } : {}),
        },
      )
      await handle.signal(adminDecisionSignal, {
        kind: "admin_decision",
        runId: admitted.receipt.runId,
        callId: approval.callId,
        approvalId: approval.approvalId,
        decision: canonical === "approved" ? "rejected" : "approved",
      })
      const restarted = await startWorker({
        taskQueue,
        queue,
        tools,
        script: [
          {
            kind: "text",
            text: decision === "approve" ? "Message sent." : "The message was not sent.",
          },
        ],
      })
      await expect
        .poll(() => handle.query(inspectStateQuery))
        .toMatchObject({ status: "waiting_for_admin" })
      await reconcileStateWorkflowSignals({
        database: context.database,
        workflowClient: environment.client.workflow,
        clock: testClock,
      })
      const result = await handle.result()
      await stopWorker(restarted)

      // Then: approval executes one send and rejection executes none.
      expect(result).toMatchObject({ status: "completed" })
      expect(ledger.executionCount("notification.send_email")).toBe(expectedSends)
      const selectedPrompt = decision === "approve" ? "P08" : "P09"
      if (process.env["ACCEPTANCE_CAPTURE_PROMPT"] === selectedPrompt) {
        await captureAcceptanceFromEnvironment(context.database, {
          runId: admitted.receipt.runId,
          fixtureNamespace: namespace,
          runtimeDiagnostics: [
            { waiting, decision, simulatedSends: ledger.executionCount("notification.send_email") },
          ],
          executionOutcome: result,
        })
      }
    },
    120_000,
  )

  it("F09 applies hidden Admin guidance once on same-run User continuation", async () => {
    // Given: a State Workflow run has one durable User wait and one hidden Admin command.
    const admitted = await admit("state_durable_user", "Wait for guidance.")
    const correlationId = "correlation_state_durable_user"
    const waitingContext = z.json().parse(
      StateWorkflowContextSchema.parse({
        kind: "state_workflow",
        consumedSteps: 1,
        messages: [{ role: "user", content: "Wait for guidance." }],
        wait: { kind: "user", correlationId },
      }),
    )
    const running = await consumeStateWorkflowStep(context.database, {
      runId: admitted.receipt.runId,
      workflowId: admitted.workflowId,
      expectedVersion: 0,
      occurredAt: testClock.now(),
      eventId: "event_state_durable_user_running",
      correlationId,
      context: waitingContext,
    })
    await persistStateWorkflowUserWait(context.database, {
      runId: admitted.receipt.runId,
      workflowId: admitted.workflowId,
      expectedVersion: running.version,
      occurredAt: testClock.now(),
      eventId: "event_state_durable_user_wait",
      statusEventId: "event_state_durable_user_status",
      correlationId,
      context: waitingContext,
    })
    const instruction = "Return the fixed ADMIN_GUIDANCE_OK token."
    await createAdminCommandService({
      database: context.database,
      clock: testClock,
      ids: admitted.ids,
    }).submit(
      { actorId: "mvp_admin" },
      {
        conversationId: "conversation_state_durable_user",
        instruction,
        expiresAt: "2026-08-17T13:00:00.000Z",
        idempotencyKey: "admin_state_durable_user",
      },
    )
    let providerRequest: ProviderRequest | undefined
    const queue = new RecordingQueue()
    const active = await startWorker({
      taskQueue: "state-durable-user",
      queue,
      tools: createToolRegistry(),
      script: [{ kind: "text", text: "ADMIN_GUIDANCE_OK" }],
      capture: (request) => {
        providerRequest = request
      },
    })
    const handle = await environment.client.workflow.start(stateWorkflow, {
      workflowId: admitted.workflowId,
      taskQueue: "state-durable-user",
      args: [
        {
          workflowId: admitted.workflowId,
          runId: admitted.receipt.runId,
          intentId: admitted.intentId,
        },
      ],
      ...STATE_WORKFLOW_START_POLICIES,
    })
    await expect
      .poll(() => handle.query(inspectStateQuery))
      .toMatchObject({ status: "waiting_for_user" })

    // When: the same run admits its exact correlated continuation and reconciliation wakes Temporal.
    await createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: admitted.ids,
    }).admit({
      commandId: "command_state_durable_user_continue",
      createdAt: testClock.now().toISOString(),
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "continue_run",
        conversationId: "conversation_state_durable_user",
        runId: admitted.receipt.runId,
        boundary: "waiting_for_user",
        correlationId,
        message: "Respond now.",
        idempotencyKey: "idempotency_state_durable_user_continue",
      },
    })
    await reconcileStateWorkflowSignals({
      database: context.database,
      workflowClient: environment.client.workflow,
      clock: testClock,
    })
    const result = await handle.result()
    await stopWorker(active)
    const evidence = await readRunEvidence(context, admitted.receipt.runId)

    // Then: guidance reaches one model request without entering User-visible messages or events.
    expect(result).toMatchObject({ status: "completed" })
    expect(providerRequest?.messages).toEqual([
      { role: "system", content: instruction },
      { role: "user", content: "Wait for guidance." },
      { role: "user", content: "Respond now." },
    ])
    expect(JSON.stringify({ events: evidence.events, messages: evidence.messages })).not.toContain(
      instruction,
    )
    await captureAcceptanceFromEnvironment(context.database, {
      runId: admitted.receipt.runId,
      fixtureNamespace: "state_durable_user",
      runtimeDiagnostics: [
        {
          workflowId: admitted.workflowId,
          providerMessageCount: providerRequest?.messages.length ?? 0,
        },
      ],
      executionOutcome: result,
    })
  }, 120_000)
})
