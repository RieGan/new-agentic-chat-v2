import { describe, expect, it } from "vitest"

import { type ProviderRequest, ProviderRequestSchema } from "../src/provider/contracts.js"
import { createProviderLanguageModel } from "../src/simple-loop/provider-model.js"

describe("application provider language model", () => {
  it("forwards the AI SDK abort signal to the application provider", async () => {
    // Given: a runtime model bridge and a caller-owned cancellation signal.
    const controller = new AbortController()
    let observedRequest: ProviderRequest | undefined
    const model = createProviderLanguageModel(
      {
        generate: async (input) => {
          observedRequest = ProviderRequestSchema.parse(input)
          return {
            ok: true,
            value: { content: [{ kind: "text", text: "cancel-safe" }], finishReason: "stop" },
          }
        },
      },
      { beforeGenerate: async (messages) => messages },
      1_000,
    )

    // When: AI SDK generation carries that signal through the private bridge.
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [],
      abortSignal: controller.signal,
    })

    // Then: the application provider receives the exact signal identity.
    expect(observedRequest?.abortSignal).toBe(controller.signal)
  })
})
