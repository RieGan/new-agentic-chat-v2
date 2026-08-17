import { MockLanguageModelV4 } from "ai/test"
import type { z } from "zod"

import { type ScriptedProviderStep, ScriptedProviderStepSchema } from "./contracts.js"

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} as const

class ScriptedProviderFailure extends Error {
  readonly name = "ScriptedProviderFailure"

  constructor() {
    super("Scripted provider failure")
  }
}

const waitForAbort = (signal: AbortSignal | undefined): Promise<never> =>
  new Promise((_, reject) => {
    const abort = () => {
      signal?.removeEventListener("abort", abort)
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"))
    }
    if (signal?.aborted === true) {
      abort()
      return
    }
    signal?.addEventListener("abort", abort, { once: true })
  })

const toMockResult = (step: ScriptedProviderStep, signal: AbortSignal | undefined) => {
  switch (step.kind) {
    case "text":
      return {
        content: [
          ...(step.reasoning === undefined
            ? []
            : [{ type: "reasoning" as const, text: step.reasoning }]),
          { type: "text" as const, text: step.text },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      }
    case "tool_calls":
      return {
        content: step.calls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.callId,
          toolName: call.toolName,
          input: JSON.stringify(call.arguments),
        })),
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      }
    case "skill_load":
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: step.callId,
            toolName: "skill.load",
            input: JSON.stringify({ skillId: step.skillId, version: step.version }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      }
    case "provider_failure":
      throw new ScriptedProviderFailure()
    case "raw_tool_call":
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: step.callId,
            toolName: step.toolName,
            input: step.input,
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage,
        warnings: [],
      }
    case "unsupported_finish_reason":
      return {
        content: [],
        finishReason: { unified: "other" as const, raw: "unsupported" },
        usage,
        warnings: [],
      }
    case "wait_for_abort":
      return waitForAbort(signal)
    default: {
      const exhaustiveStep: never = step
      return exhaustiveStep
    }
  }
}

export const createScriptedModel = (input: unknown) => {
  const steps: z.infer<typeof ScriptedProviderStepSchema>[] = ScriptedProviderStepSchema.array()
    .min(1)
    .parse(input)
  let stepIndex = 0

  return new MockLanguageModelV4({
    doGenerate: async ({ abortSignal }) => {
      const step = steps[stepIndex]
      stepIndex += 1
      if (step === undefined) {
        throw new ScriptedProviderFailure()
      }
      return await toMockResult(step, abortSignal)
    },
  })
}
