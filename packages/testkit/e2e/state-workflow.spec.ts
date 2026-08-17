import { expect, test } from "@playwright/test"

import type { ApplicationTestContext } from "../../runtime/tests/application-support.js"
import {
  startApplicationTestContext,
  stopApplicationTestContext,
} from "../../runtime/tests/application-support.js"
import { SYNCHRONOUS_FLOW_FIXTURES } from "../../runtime/tests/simple-loop-support.js"
import {
  executeStateWorkflowScenario,
  type StateWorkflowTestEnvironment,
  startStateWorkflowTestEnvironment,
} from "../../runtime/tests/state-workflow-support.js"
import { emitAcceptanceEvidence } from "./acceptance-support.js"

const requestedRuntime = process.env["TEST_RUNTIME"]
const requestedFlows = process.env["TEST_FLOWS"]?.split(",") ?? []
const selected =
  requestedRuntime === "state_workflow" &&
  (requestedFlows.length === 0 || requestedFlows.includes("F01-F05"))

test.describe("State Workflow F01-F05", () => {
  test.skip(!selected, "State Workflow F01-F05 was not selected")
  test.setTimeout(120_000)
  let context: ApplicationTestContext
  let environment: StateWorkflowTestEnvironment

  test.beforeAll(async () => {
    ;[context, environment] = await Promise.all([
      startApplicationTestContext(),
      startStateWorkflowTestEnvironment(),
    ])
  })

  test.afterAll(async () => {
    await Promise.all([stopApplicationTestContext(context), environment.teardown()])
  })

  test("F01 direct answer is atomically visible", async ({ playwright: _playwright }, testInfo) => {
    // Given: P01 has one deterministic model response.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.direct,
    )

    // When: canonical messages are projected after real Temporal completion.
    const aiMessages = executed.evidence.messages.filter((message) => message.actor === "ai")

    // Then: one complete AI message exists with no partial event or tool call.
    expect(aiMessages).toEqual([{ actor: "ai", content: "CHAT_OK" }])
    expect(executed.evidence.events.some((event) => event.type === "message.delta")).toBe(false)
    expect(executed.evidence.calls).toEqual([])
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F01",
      promptId: "P01",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.direct.namespace,
      runId: executed.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: executed.providerInvocations,
          advanceAttempts: executed.advanceAttempts,
        },
      ],
      executionOutcome: executed.workflowResult,
      testInfo,
    })
  })

  test("F02 skill load remains a control operation", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P02 selects calculator_assistant@1.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.skill,
    )

    // When: canonical State Workflow evidence is read.
    const eventTypes = executed.evidence.events.map((event) => event.type)

    // Then: the skill snapshot emits skill.loaded with no tool row.
    expect(eventTypes).toContain("skill.loaded")
    expect(executed.evidence.calls).toEqual([])
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F02",
      promptId: "P02",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.skill.namespace,
      runId: executed.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: executed.providerInvocations,
          advanceAttempts: executed.advanceAttempts,
        },
      ],
      executionOutcome: executed.workflowResult,
      testInfo,
    })
  })

  test("F03 calculator succeeds through real Temporal Activities", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P03 loads calculator and requests the exact fixture expression.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.calculator,
    )

    // When: the canonical terminal tool row is observed.
    const call = executed.evidence.calls[0]

    // Then: one successful result and exact final answer are durable.
    expect(call).toMatchObject({
      tool_id: "calculator.evaluate",
      status: "completed",
      result: { value: 1040 },
    })
    expect(executed.evidence.messages).toContainEqual({ actor: "ai", content: "1040" })
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F03",
      promptId: "P03",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.calculator.namespace,
      runId: executed.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: executed.providerInvocations,
          advanceAttempts: executed.advanceAttempts,
        },
      ],
      executionOutcome: executed.workflowResult,
      testInfo,
    })
  })

  test("F04 typed calculator failure still completes with final text", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P04 requests division by zero.
    const executed = await executeStateWorkflowScenario(
      context,
      environment,
      SYNCHRONOUS_FLOW_FIXTURES.divisionByZero,
    )

    // When: the failed tool row and workflow result are read.
    const call = executed.evidence.calls[0]

    // Then: DIVISION_BY_ZERO is durable and the workflow completes normally.
    expect(call).toMatchObject({ status: "failed", error: { code: "DIVISION_BY_ZERO" } })
    expect(executed.workflowResult.status).toBe("completed")
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F04",
      promptId: "P04",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.divisionByZero.namespace,
      runId: executed.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: executed.providerInvocations,
          advanceAttempts: executed.advanceAttempts,
        },
      ],
      executionOutcome: executed.workflowResult,
      testInfo,
    })
  })

  test("F05 missing and prohibited requests invoke no prohibited fixture", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P05 and P06 are independent deterministic runs.
    const [missing, disallowed] = await Promise.all([
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.missingSkill),
      executeStateWorkflowScenario(context, environment, SYNCHRONOUS_FLOW_FIXTURES.disallowed),
    ])

    // When: persisted rows and fixture ledgers are inspected.
    const disallowedCall = disallowed.evidence.calls[0]

    // Then: missing skill has no row and denied send has no executor effect.
    expect(missing.evidence.calls).toEqual([])
    expect(disallowedCall).toMatchObject({
      tool_id: "notification.send_email",
      status: "rejected",
      error: { code: "TOOL_NOT_ALLOWED" },
    })
    expect(disallowed.ledger.executionCount("notification.send_email")).toBe(0)
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F05",
      promptId: "P05",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.missingSkill.namespace,
      runId: missing.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: missing.providerInvocations,
          advanceAttempts: missing.advanceAttempts,
        },
      ],
      executionOutcome: missing.workflowResult,
      testInfo,
    })
    await emitAcceptanceEvidence(context.database, {
      runtime: "state_workflow",
      testId: "F05",
      promptId: "P06",
      fixtureNamespace: SYNCHRONOUS_FLOW_FIXTURES.disallowed.namespace,
      runId: disallowed.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: disallowed.providerInvocations,
          advanceAttempts: disallowed.advanceAttempts,
          prohibitedExecutions: disallowed.ledger.executionCount("notification.send_email"),
        },
      ],
      executionOutcome: disallowed.workflowResult,
      testInfo,
    })
  })
})
