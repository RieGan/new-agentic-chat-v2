import { describe, expect, it } from "vitest"

import { EnvironmentConfigError, parseEnvironment } from "../src/environment.js"
import { createComposeProvider } from "../src/provider/factory.js"

const request = {
  messages: [{ role: "user", content: "TASK18 report selection" }],
  tools: ["skill.load"],
  timeoutMs: 1_000,
} as const

describe("Compose provider selection", () => {
  it("uses the Task 18 deterministic provider when parsed mode is mock", async () => {
    // Given
    const configuration = parseEnvironment({ AI_PROVIDER_MODE: "mock" })
    const provider = createComposeProvider(configuration)

    // When
    const result = await provider.generate(request)

    // Then
    expect(result.ok ? result.value.content : []).toEqual([
      {
        kind: "tool_call",
        callId: "call_skill_selection",
        toolName: "skill.load",
        arguments: { skillId: "report_assistant", version: "1" },
      },
    ])
  })

  it("uses the OpenAI Responses transport when parsed mode is live", async () => {
    // Given
    const observedUrls: string[] = []
    const configuration = parseEnvironment({
      AI_PROVIDER_MODE: "openai_responses",
      OPENAI_MODEL_ID: "model-sentinel",
      OPENAI_BASE_URL: "https://provider.example.test/v1",
      OPENAI_API_KEY: "key-sentinel",
    })
    const provider = createComposeProvider(configuration, {
      fetch: async (input) => {
        observedUrls.push(String(input))
        return new Response("provider unavailable", { status: 503 })
      },
    })

    // When
    const result = await provider.generate({
      ...request,
      messages: [{ role: "user", content: "hello" }],
    })

    // Then
    expect(observedUrls).toEqual(["https://provider.example.test/v1/responses"])
    expect(result.ok).toBe(false)
  })

  it("fails closed with variable names and no values when live configuration is invalid", () => {
    // Given
    const secret = "key-must-remain-redacted"

    // When
    const captureError = (): EnvironmentConfigError => {
      try {
        parseEnvironment({
          AI_PROVIDER_MODE: "openai_responses",
          OPENAI_MODEL_ID: "",
          OPENAI_BASE_URL: "not-a-url",
          OPENAI_API_KEY: secret,
        })
      } catch (error) {
        if (error instanceof EnvironmentConfigError) return error
        throw error
      }
      return expect.unreachable("invalid live configuration must fail before readiness")
    }
    const error = captureError()

    // Then
    expect(error.variables).toEqual(["OPENAI_MODEL_ID", "OPENAI_BASE_URL"])
    expect(error.message).not.toContain(secret)
    expect(error.message).not.toContain("not-a-url")
  })
})
