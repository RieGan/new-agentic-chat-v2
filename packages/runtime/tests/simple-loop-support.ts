import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"

import { createAdmissionService } from "../src/application/index.js"
import { createScriptedProvider, type ScriptedProviderStep } from "../src/provider/index.js"
import { createSimpleLoopRuntime } from "../src/simple-loop/index.js"
import type { ApplicationTestContext } from "./application-support.js"
import { createOwnedConversation, createTestIds, testClock } from "./application-support.js"

export { readRunEvidence } from "./run-evidence-support.js"

export type SimpleLoopScenario = {
  readonly namespace: string
  readonly prompt: string
  readonly script: readonly ScriptedProviderStep[] | readonly unknown[]
}

export const SYNCHRONOUS_FLOW_FIXTURES = {
  direct: {
    namespace: "f01",
    prompt: "Reply with exactly CHAT_OK. Do not load a skill or call a tool.",
    script: [{ kind: "text", text: "CHAT_OK" }],
  },
  skill: {
    namespace: "f02",
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
  },
  calculator: {
    namespace: "f03",
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
  },
  divisionByZero: {
    namespace: "f04",
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
  },
  preview: {
    namespace: "preview",
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
  },
  missingSkill: {
    namespace: "f05_missing",
    prompt: "Load missing_skill version 1 and use it.",
    script: [
      { kind: "skill_load", callId: "call_missing", skillId: "missing_skill", version: "1" },
      { kind: "text", text: "The requested skill was not found." },
    ],
  },
  disallowed: {
    namespace: "f05_disallowed",
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
  },
  malformed: {
    namespace: "malformed",
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
  },
  providerFailure: {
    namespace: "provider_failure",
    prompt: "Respond once.",
    script: [{ kind: "provider_failure" }],
  },
  stepLimit: {
    namespace: "step_limit",
    prompt: "Keep calculating.",
    script: [
      {
        kind: "skill_load",
        callId: "call_skill_limit",
        skillId: "calculator_assistant",
        version: "1",
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        kind: "tool_calls" as const,
        calls: [
          {
            callId: `call_repeat_${index + 1}`,
            toolName: "calculator.evaluate" as const,
            arguments: { expression: "1 + 1" },
          },
        ],
      })),
    ],
  },
} as const satisfies Readonly<Record<string, SimpleLoopScenario>>

export const executeScenario = async (
  context: ApplicationTestContext,
  scenario: SimpleLoopScenario,
) => {
  const ids = createTestIds(scenario.namespace)
  await createOwnedConversation(context, `conversation_${scenario.namespace}`)
  const receipt = await createAdmissionService({
    database: context.database,
    clock: testClock,
    ids,
  }).admit({
    commandId: `command_${scenario.namespace}`,
    createdAt: testClock.now().toISOString(),
    type: "chat.send_message",
    actorId: "mvp_user",
    payload: {
      kind: "new_run",
      conversationId: `conversation_${scenario.namespace}`,
      runtime: "simple_loop",
      message: scenario.prompt,
      idempotencyKey: `idempotency_${scenario.namespace}`,
    },
  })
  const ledger = createInvocationLedger()
  let providerInvocations = 0
  const scripted = createScriptedProvider(scenario.script)
  const provider = {
    generate: async (input: unknown) => {
      providerInvocations += 1
      return scripted.generate(input)
    },
  }
  const runtime = createSimpleLoopRuntime({
    database: context.database,
    clock: testClock,
    ids,
    provider,
    tools: createToolRegistry({ ledger }),
    timeoutMs: 1_000,
  })
  const result = await runtime.execute({
    runId: receipt.runId,
    owner: `worker_${scenario.namespace}`,
    durationSeconds: 30,
  })
  return { receipt, result, ledger, providerInvocations }
}
