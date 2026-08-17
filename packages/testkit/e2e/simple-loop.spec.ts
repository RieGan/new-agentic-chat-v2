import { expect, test } from "@playwright/test"

import type { ApplicationTestContext } from "../../runtime/tests/application-support.js"
import {
  startApplicationTestContext,
  stopApplicationTestContext,
} from "../../runtime/tests/application-support.js"
import { executeScenario, readRunEvidence } from "../../runtime/tests/simple-loop-support.js"
import { emitAcceptanceEvidence } from "./acceptance-support.js"

const requestedRuntime = process.env["TEST_RUNTIME"]
const requestedFlows = process.env["TEST_FLOWS"]?.split(",") ?? []
const taskTenRequested =
  (requestedRuntime === undefined || requestedRuntime === "simple_loop") &&
  (requestedFlows.length === 0 || requestedFlows.includes("F01-F05"))

test.describe("Simple Loop F01-F05", () => {
  test.skip(!taskTenRequested, "Simple Loop F01-F05 was not selected")
  test.setTimeout(120_000)
  let context: ApplicationTestContext

  test.beforeAll(async () => {
    context = await startApplicationTestContext()
  })

  test.afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  test("F01 direct answer is atomically visible", async ({ playwright: _playwright }, testInfo) => {
    // Given: P01 has one deterministic model response.
    const executed = await executeScenario(context, {
      namespace: "e2e_f01",
      prompt: "Reply with exactly CHAT_OK. Do not load a skill or call a tool.",
      script: [{ kind: "text", text: "CHAT_OK" }],
    })

    // When: the completed run is projected from durable records.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: one complete AI message exists with no tool calls.
    expect(executed.result).toMatchObject({ status: "completed", text: "CHAT_OK" })
    expect(evidence.messages.filter((message) => message.actor === "ai")).toEqual([
      { actor: "ai", content: "CHAT_OK" },
    ])
    expect(evidence.calls).toEqual([])
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F01",
      promptId: "P01",
      fixtureNamespace: "e2e_f01",
      runId: executed.receipt.runId,
      runtimeDiagnostics: [{ providerInvocations: executed.providerInvocations }],
      executionOutcome: executed.result,
      testInfo,
    })
  })

  test("F02 skill load remains a control operation", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P02 selects calculator_assistant@1.
    const executed = await executeScenario(context, {
      namespace: "e2e_f02",
      prompt: "Load calculator_assistant version 1.",
      script: [
        {
          kind: "skill_load",
          callId: "call_e2e_skill",
          skillId: "calculator_assistant",
          version: "1",
        },
        { kind: "text", text: "calculator_assistant@1" },
      ],
    })

    // When: canonical state is read.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: skill.loaded exists and no tool row exists.
    expect(evidence.events.map((event) => event.type)).toContain("skill.loaded")
    expect(evidence.calls).toEqual([])
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F02",
      promptId: "P02",
      fixtureNamespace: "e2e_f02",
      runId: executed.receipt.runId,
      runtimeDiagnostics: [{ providerInvocations: executed.providerInvocations }],
      executionOutcome: executed.result,
      testInfo,
    })
  })

  test("F03 calculator succeeds through the bounded agent", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P03 loads the skill, calls calculator.evaluate, and answers from its result.
    const executed = await executeScenario(context, {
      namespace: "e2e_f03",
      prompt: "Use calculator_assistant version 1 to calculate (125 * 8) + 40.",
      script: [
        {
          kind: "skill_load",
          callId: "call_e2e_f03_skill",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_e2e_f03_calculator",
              toolName: "calculator.evaluate",
              arguments: { expression: "(125 * 8) + 40" },
            },
          ],
        },
        { kind: "text", text: "1040" },
      ],
    })

    // When: terminal state is observed.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: one successful calculator call and the exact final answer are durable.
    expect(executed.result).toMatchObject({ status: "completed", text: "1040" })
    expect(evidence.calls).toMatchObject([{ tool_id: "calculator.evaluate", status: "completed" }])
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F03",
      promptId: "P03",
      fixtureNamespace: "e2e_f03",
      runId: executed.receipt.runId,
      runtimeDiagnostics: [{ providerInvocations: executed.providerInvocations }],
      executionOutcome: executed.result,
      testInfo,
    })
  })

  test("F04 typed calculator failure still yields a complete explanation", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P04 requests division by zero.
    const executed = await executeScenario(context, {
      namespace: "e2e_f04",
      prompt: "Use calculator_assistant version 1 and calculate 10 / 0.",
      script: [
        {
          kind: "skill_load",
          callId: "call_e2e_f04_skill",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_e2e_f04_calculator",
              toolName: "calculator.evaluate",
              arguments: { expression: "10 / 0" },
            },
          ],
        },
        { kind: "text", text: "Division by zero is undefined." },
      ],
    })

    // When: the tool ledger is read.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: DIVISION_BY_ZERO is durable and the run completes.
    expect(executed.result.status).toBe("completed")
    expect(evidence.calls[0]).toMatchObject({
      status: "failed",
      error: { code: "DIVISION_BY_ZERO" },
    })
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F04",
      promptId: "P04",
      fixtureNamespace: "e2e_f04",
      runId: executed.receipt.runId,
      runtimeDiagnostics: [{ providerInvocations: executed.providerInvocations }],
      executionOutcome: executed.result,
      testInfo,
    })
  })

  test("F05 missing and prohibited requests remain side-effect free", async ({
    playwright: _playwright,
  }, testInfo) => {
    // Given: P05 and P06 are independent failing runs.
    const missing = await executeScenario(context, {
      namespace: "e2e_f05_missing",
      prompt: "Load missing_skill version 1 and use it.",
      script: [
        { kind: "skill_load", callId: "call_e2e_missing", skillId: "missing_skill", version: "1" },
        { kind: "text", text: "The requested skill was not found." },
      ],
    })
    const prohibited = await executeScenario(context, {
      namespace: "e2e_f05_prohibited",
      prompt: "Load calculator_assistant version 1, then send an email.",
      script: [
        {
          kind: "skill_load",
          callId: "call_e2e_f05_skill",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "raw_tool_call",
          callId: "call_e2e_f05_send",
          toolName: "notification.send_email",
          input: '{"previewId":"preview_forbidden"}',
        },
      ],
    })

    // When: typed outcomes and fixture counters are observed.
    const missingEvidence = await readRunEvidence(context, missing.receipt.runId)

    // Then: errors are distinct and no prohibited fixture executes.
    expect(missing.result).toMatchObject({ error: { code: "SKILL_NOT_FOUND" } })
    expect(missingEvidence.calls).toEqual([])
    expect(prohibited.result).toMatchObject({ error: { code: "TOOL_NOT_ALLOWED" } })
    expect(prohibited.ledger.executionCount("notification.send_email")).toBe(0)
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F05",
      promptId: "P05",
      fixtureNamespace: "e2e_f05_missing",
      runId: missing.receipt.runId,
      runtimeDiagnostics: [{ providerInvocations: missing.providerInvocations }],
      executionOutcome: missing.result,
      testInfo,
    })
    await emitAcceptanceEvidence(context.database, {
      runtime: "simple_loop",
      testId: "F05",
      promptId: "P06",
      fixtureNamespace: "e2e_f05_prohibited",
      runId: prohibited.receipt.runId,
      runtimeDiagnostics: [
        {
          providerInvocations: prohibited.providerInvocations,
          prohibitedExecutions: prohibited.ledger.executionCount("notification.send_email"),
        },
      ],
      executionOutcome: prohibited.result,
      testInfo,
    })
  })
})
