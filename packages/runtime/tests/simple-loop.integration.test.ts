import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { ApplicationTestContext } from "./application-support.js"
import { startApplicationTestContext, stopApplicationTestContext } from "./application-support.js"
import { executeScenario, readRunEvidence } from "./simple-loop-support.js"

describe("Simple Loop F01-F05 synchronous flows", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("persists one atomic final answer when direct chat completes", async () => {
    // Given: P01 has one deterministic text step.
    const scenario = {
      namespace: "simple_f01",
      prompt: "Reply with exactly CHAT_OK. Do not load a skill or call a tool.",
      script: [{ kind: "text", text: "CHAT_OK" }] as const,
    }

    // When: the admitted Simple Loop run executes.
    const executed = await executeScenario(context, scenario)
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: one AI message and completion event exist without tool or skill records.
    expect(executed.result).toMatchObject({
      status: "completed",
      text: "CHAT_OK",
      consumedSteps: 1,
    })
    expect(evidence.messages).toEqual([
      { actor: "user", content: scenario.prompt },
      { actor: "ai", content: "CHAT_OK" },
    ])
    expect(evidence.events.map((event) => event.type)).toEqual([
      "message.completed",
      "run.status_changed",
      "message.completed",
      "run.status_changed",
    ])
    expect(evidence.calls).toEqual([])
  })

  it("loads calculator_assistant as control state without a tool-call row", async () => {
    // Given: P02 scripts a skill control call followed by confirmation.
    const executed = await executeScenario(context, {
      namespace: "simple_f02",
      prompt: "Load calculator_assistant version 1.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_f02",
          skillId: "calculator_assistant",
          version: "1",
        },
        { kind: "text", text: "calculator_assistant@1" },
      ],
    })

    // When: durable evidence is read after completion.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: skill.loaded is present and no AI tool call exists.
    expect(evidence.events.map((event) => event.type)).toEqual([
      "message.completed",
      "run.status_changed",
      "skill.loaded",
      "message.completed",
      "run.status_changed",
    ])
    expect(evidence.calls).toEqual([])
    expect(evidence.run?.continuation).toMatchObject({
      consumedSteps: 2,
      selectedSkill: { skillId: "calculator_assistant" },
    })
  })

  it("executes calculator.evaluate once and persists its canonical result", async () => {
    // Given: P03 loads the calculator and requests the required calculation.
    const executed = await executeScenario(context, {
      namespace: "simple_f03",
      prompt: "Use calculator_assistant version 1 to calculate (125 * 8) + 40.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_f03",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_calculator_f03",
              toolName: "calculator.evaluate",
              arguments: { expression: "(125 * 8) + 40" },
            },
          ],
        },
        { kind: "text", text: "1040" },
      ],
    })

    // When: the persisted call is inspected.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: one executor invocation, completed row, and final answer agree.
    expect(executed.ledger.executionCount("calculator.evaluate")).toBe(1)
    expect(evidence.calls).toMatchObject([
      { tool_id: "calculator.evaluate", status: "completed", result: { value: 1040 } },
    ])
    expect(executed.result).toMatchObject({ status: "completed", text: "1040", consumedSteps: 3 })
  })

  it("persists DIVISION_BY_ZERO and still completes with a User explanation", async () => {
    // Given: P04 requests a typed calculator failure.
    const executed = await executeScenario(context, {
      namespace: "simple_f04",
      prompt: "Use calculator_assistant version 1 and calculate 10 / 0.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_f04",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_calculator_f04",
              toolName: "calculator.evaluate",
              arguments: { expression: "10 / 0" },
            },
          ],
        },
        {
          kind: "text",
          text: "The calculation is undefined because division by zero is not allowed.",
        },
      ],
    })

    // When: the terminal row is inspected.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: the typed failure is durable and the run does not crash.
    expect(evidence.calls[0]).toMatchObject({
      status: "failed",
      error: { code: "DIVISION_BY_ZERO" },
    })
    expect(executed.result.status).toBe("completed")
  })

  it("executes notification.preview synchronously without creating a send", async () => {
    // Given: communication_assistant allows preview but no approved send is requested.
    const executed = await executeScenario(context, {
      namespace: "simple_preview",
      prompt: "Load communication_assistant and preview a notification.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_preview",
          skillId: "communication_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_preview",
              toolName: "notification.preview",
              arguments: { recipient: "QA@EXAMPLE.COM", subject: " MVP ", body: "Preview only" },
            },
          ],
        },
        { kind: "text", text: "Preview created." },
      ],
    })

    // When: fixture execution counters are inspected.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: preview executes once and send executes zero times.
    expect(executed.ledger.executionCount("notification.preview")).toBe(1)
    expect(executed.ledger.executionCount("notification.send_email")).toBe(0)
    expect(evidence.calls[0]).toMatchObject({
      status: "completed",
      tool_id: "notification.preview",
    })
  })

  it("keeps missing skill and disallowed tool failures distinct with zero prohibited execution", async () => {
    // Given: P05 and P06 are separate deterministic runs.
    const missing = await executeScenario(context, {
      namespace: "simple_f05_missing",
      prompt: "Load missing_skill version 1 and use it.",
      script: [
        { kind: "skill_load", callId: "call_missing", skillId: "missing_skill", version: "1" },
        { kind: "text", text: "The requested skill was not found." },
      ],
    })
    const disallowed = await executeScenario(context, {
      namespace: "simple_f05_disallowed",
      prompt: "Load calculator_assistant version 1, then send an email.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_f05",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "raw_tool_call",
          callId: "call_send_f05",
          toolName: "notification.send_email",
          input: '{"previewId":"preview_forbidden"}',
        },
      ],
    })

    // When: both terminal outcomes are inspected.
    const missingEvidence = await readRunEvidence(context, missing.receipt.runId)
    const disallowedEvidence = await readRunEvidence(context, disallowed.receipt.runId)

    // Then: typed outcomes remain distinct and no send executor runs.
    expect(missing.result).toMatchObject({ error: { code: "SKILL_NOT_FOUND" } })
    expect(missingEvidence.calls).toEqual([])
    expect(disallowed.result).toMatchObject({ error: { code: "TOOL_NOT_ALLOWED" } })
    expect(disallowedEvidence.calls[0]).toMatchObject({
      status: "rejected",
      tool_id: "notification.send_email",
    })
    expect(disallowed.ledger.executionCount("notification.send_email")).toBe(0)
  })

  it("rejects malformed input before policy and execution while consuming its model step", async () => {
    // Given: the provider emits malformed calculator JSON after loading its skill.
    const executed = await executeScenario(context, {
      namespace: "simple_malformed",
      prompt: "Load calculator_assistant and calculate malformed input.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_malformed",
          skillId: "calculator_assistant",
          version: "1",
        },
        {
          kind: "raw_tool_call",
          callId: "call_malformed",
          toolName: "calculator.evaluate",
          input: "{}",
        },
      ],
    })

    // When: persisted state and fixture counts are inspected.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: the malformed step is consumed and no calculator executor is invoked.
    expect(executed.result).toMatchObject({ error: { code: "INVALID_SCHEMA" }, consumedSteps: 2 })
    expect(evidence.calls[0]).toMatchObject({ status: "failed", tool_id: "calculator.evaluate" })
    expect(executed.ledger.executionCount("calculator.evaluate")).toBe(0)
  })

  it("maps provider failure to a typed terminal result with one atomic explanation", async () => {
    // Given: the first model step fails through the provider boundary.
    const executed = await executeScenario(context, {
      namespace: "simple_provider_failure",
      prompt: "Respond once.",
      script: [{ kind: "provider_failure" }],
    })

    // When: final evidence is loaded.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: one consumed step and one complete AI explanation are durable.
    expect(executed.result).toMatchObject({
      status: "failed",
      error: { code: "INVALID_SCHEMA" },
      consumedSteps: 1,
    })
    expect(evidence.messages.filter((message) => message.actor === "ai")).toHaveLength(1)
    expect(evidence.events.filter((event) => event.type === "message.completed")).toHaveLength(2)
  })

  it("stops after eight model steps with no ninth provider or tool invocation", async () => {
    // Given: a model attempts more tool steps than the frozen budget.
    const repeatedCalls = Array.from({ length: 8 }, (_, index) => ({
      kind: "tool_calls" as const,
      calls: [
        {
          callId: `call_repeat_${index + 1}`,
          toolName: "calculator.evaluate" as const,
          arguments: { expression: "1 + 1" },
        },
      ],
    }))
    const executed = await executeScenario(context, {
      namespace: "simple_limit",
      prompt: "Keep calculating.",
      script: [
        {
          kind: "skill_load",
          callId: "call_skill_limit",
          skillId: "calculator_assistant",
          version: "1",
        },
        ...repeatedCalls,
      ],
    })

    // When: the bounded result is observed.
    const evidence = await readRunEvidence(context, executed.receipt.runId)

    // Then: step eight terminates before the ninth scripted call can run.
    expect(executed.result).toMatchObject({
      error: { code: "LOOP_STEP_LIMIT_EXCEEDED", limit: 8 },
      consumedSteps: 8,
    })
    expect(executed.providerInvocations).toBe(8)
    expect(executed.ledger.executionCount("calculator.evaluate")).toBe(7)
    expect(evidence.run?.consumed_steps).toBe(8)
  })
})
