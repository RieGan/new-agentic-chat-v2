import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"
import { TestWorkflowEnvironment } from "@temporalio/testing"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAdmissionService } from "../src/application/index.js"
import type { ReportJobQueue } from "../src/application/report-jobs.js"
import { createScriptedProvider } from "../src/provider/index.js"
import { createStateWorkflowActivityAdapter } from "../src/state-workflow/activity-adapter.js"
import { StateWorkflowContextSchema } from "../src/state-workflow/context.js"
import type { ApplicationTestContext } from "./application-support.js"
import {
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"
import { readRunEvidence, SYNCHRONOUS_FLOW_FIXTURES } from "./simple-loop-support.js"
import { executeStateWorkflowScenario } from "./state-workflow-support.js"

describe("State Workflow F01-F05 synchronous flows", () => {
  let context: ApplicationTestContext
  let environment: TestWorkflowEnvironment

  beforeAll(async () => {
    ;[context, environment] = await Promise.all([
      startApplicationTestContext(),
      TestWorkflowEnvironment.createLocal(),
    ])
  }, 120_000)

  afterAll(async () => {
    await Promise.all([stopApplicationTestContext(context), environment.teardown()])
  })

  it("persists one atomic final answer and replays a post-commit Activity retry", async () => {
    // Given: P01 has one text result and the first advance delivery times out after commit.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.direct,
      { failAfterAdvanceCommitOnce: true },
    )

    // When: Temporal retries the stable advance Activity identity.
    const aiMessages = executed.evidence.messages.filter((message) => message.actor === "ai")

    // Then: the retry performs no second provider call, message, or completion event.
    expect(executed.workflowResult).toMatchObject({ status: "completed" })
    expect(executed.advanceAttempts).toBe(2)
    expect(executed.providerInvocations).toBe(1)
    expect(aiMessages).toEqual([{ actor: "ai", content: "CHAT_OK" }])
    expect(
      executed.evidence.events.filter((event) => event.type === "message.completed"),
    ).toHaveLength(2)
    expect(executed.evidence.calls).toEqual([])
  })

  it("persists skill.load as control state without a tool row", async () => {
    // Given: P02 loads the exact calculator skill snapshot.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.skill,
    )

    // When: canonical events and rows are inspected after workflow completion.
    const eventTypes = executed.evidence.events.map((event) => event.type)

    // Then: skill.loaded is durable while tool_calls remains empty.
    expect(eventTypes).toContain("skill.loaded")
    expect(executed.evidence.calls).toEqual([])
    expect(executed.evidence.run).toMatchObject({ consumed_steps: 2, status: "completed" })
  })

  it("executes calculator success, typed failure, and notification preview once", async () => {
    // Given: P03, P04, and the synchronous preview fixture use canonical skill allowlists.
    const [calculator, division, preview] = await Promise.all([
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.calculator),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.divisionByZero),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.preview),
    ])

    // When: terminal tool rows and invocation ledgers are read.
    const calculatorCall = calculator.evidence.calls[0]
    const divisionCall = division.evidence.calls[0]
    const previewCall = preview.evidence.calls[0]

    // Then: each allowed fixture runs once and send remains untouched.
    expect(calculatorCall).toMatchObject({
      tool_id: "calculator.evaluate",
      status: "completed",
      result: { value: 1040 },
    })
    expect(calculator.ledger.executionCount("calculator.evaluate")).toBe(1)
    expect(divisionCall).toMatchObject({
      tool_id: "calculator.evaluate",
      status: "failed",
      error: { code: "DIVISION_BY_ZERO" },
    })
    expect(division.ledger.executionCount("calculator.evaluate")).toBe(1)
    expect(previewCall).toMatchObject({ tool_id: "notification.preview", status: "completed" })
    expect(preview.ledger.executionCount("notification.preview")).toBe(1)
    expect(preview.ledger.executionCount("notification.send_email")).toBe(0)
  })

  it("keeps missing, disallowed, malformed, and provider failures typed and side-effect free", async () => {
    // Given: P05/P06 and boundary-failure fixtures are independent State Workflow runs.
    const [missing, disallowed, malformed, providerFailure] = await Promise.all([
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.missingSkill),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.disallowed),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.malformed),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.providerFailure),
    ])

    // When: architecture-neutral continuation and fixture ledgers are inspected.
    const contexts = [missing, disallowed, malformed, providerFailure].map((executed) =>
      StateWorkflowContextSchema.parse(executed.evidence.run?.continuation),
    )

    // Then: model budget is consumed and no prohibited fixture executes.
    expect(contexts.map((value) => value.terminalError?.code)).toEqual([
      "SKILL_NOT_FOUND",
      "TOOL_NOT_ALLOWED",
      "INVALID_SCHEMA",
      "INVALID_SCHEMA",
    ])
    expect(contexts.map((value) => value.consumedSteps)).toEqual([2, 2, 2, 1])
    expect(missing.evidence.calls).toEqual([])
    expect(disallowed.ledger.executionCount("notification.send_email")).toBe(0)
    expect(malformed.ledger.executionCount("calculator.evaluate")).toBe(0)
    expect(
      providerFailure.evidence.messages.filter((message) => message.actor === "ai"),
    ).toHaveLength(1)
  })

  it("stops at eight provider steps without a ninth provider or tool invocation", async () => {
    // Given: the bounded fixture offers one skill step and eight calculator steps.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.stepLimit,
    )

    // When: the terminal continuation and invocation counts are inspected.
    const continuation = StateWorkflowContextSchema.parse(executed.evidence.run?.continuation)

    // Then: exactly eight model steps and seven calculator effects are durable.
    expect(continuation.terminalError).toMatchObject({
      code: "LOOP_STEP_LIMIT_EXCEEDED",
      limit: 8,
    })
    expect(executed.providerInvocations).toBe(8)
    expect(executed.ledger.executionCount("calculator.evaluate")).toBe(7)
    expect(executed.evidence.run?.consumed_steps).toBe(8)
  })

  it("persists a canonical report wait before returning its directive", async () => {
    // Given: a State Workflow run requests one asynchronous report.
    const ids = createTestIds("state-wait-f06-red")
    const receipt = await createAdmissionService({
      database: context.database,
      clock: testClock,
      ids,
    }).admit({
      commandId: "command_state_wait_f06_red",
      createdAt: testClock.now().toISOString(),
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_state_wait_f06_red",
        runtime: "state_workflow",
        message: "Generate the quarterly report.",
        idempotencyKey: "idempotency_state_wait_f06_red",
      },
    })
    const intent = await context.database.pool.query<{ readonly id: string }>(
      "select id from dispatch_intents where aggregate_id = $1 and topic = 'state_workflow.start'",
      [receipt.runId],
    )
    const intentId = intent.rows[0]?.id
    if (intentId === undefined) throw new TypeError("Expected State Workflow start intent")
    const queued: Parameters<ReportJobQueue["enqueue"]>[0][] = []
    const adapter = createStateWorkflowActivityAdapter({
      database: context.database,
      clock: testClock,
      provider: createScriptedProvider([
        {
          kind: "skill_load",
          callId: "call_skill_state_wait_f06_red",
          skillId: "report_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_report_state_wait_f06_red",
              toolName: "report.generate",
              arguments: { topic: "quarterly", sections: ["summary"] },
            },
          ],
        },
      ]),
      tools: createToolRegistry({ ledger: createInvocationLedger() }),
      timeoutMs: 1_000,
      durableWaits: {
        namespace: "state-workflow-waits",
        reportQueue: { enqueue: async (payload) => void queued.push(payload) },
      },
    })
    const workflowId = `agent-run/${receipt.runId}`
    await adapter.reconcileStartOnce({
      workflowId,
      runId: receipt.runId,
      intentId,
      historyPosition: 1,
      idempotencyKey: `${workflowId}/start/${intentId}`,
    })

    // When: the Activity reaches the deferred report tool call.
    const directive = await adapter.advanceRunOnce({
      workflowId,
      runId: receipt.runId,
      historyPosition: 1,
      idempotencyKey: `${workflowId}/advance/1`,
    })
    const evidence = await readRunEvidence(context, receipt.runId)

    // Then: PostgreSQL and queue identity are stable before Temporal receives the wait.
    expect(directive).toEqual({
      kind: "wait_for_job",
      callId: "call_report_state_wait_f06_red",
      jobId: "job_001",
    })
    expect(evidence.run).toMatchObject({ status: "waiting_for_tool", consumed_steps: 2 })
    expect(evidence.calls).toContainEqual(
      expect.objectContaining({ tool_id: "report.generate", status: "waiting_job" }),
    )
    expect(queued).toHaveLength(1)
  })
})
