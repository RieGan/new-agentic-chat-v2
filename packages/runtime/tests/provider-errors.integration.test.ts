import { describe, expect, it } from "vitest"

import { createProvider, createScriptedProvider } from "../src/provider/index.js"

const request = {
  messages: [{ role: "user", content: "hello" }],
  tools: [],
  timeoutMs: 1_000,
} as const

describe("provider failures", () => {
  it("maps a scripted provider failure to a typed redacted result", async () => {
    // Given
    const provider = createScriptedProvider([{ kind: "provider_failure" }])

    // When
    const result = await provider.generate(request)

    // Then
    expect(result).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_FAILURE",
        message: "Provider request failed",
        retryable: true,
      },
    })
  })

  it("maps malformed model tool JSON to a typed invalid-response result", async () => {
    // Given
    const provider = createScriptedProvider([
      {
        kind: "raw_tool_call",
        callId: "call_bad",
        toolName: "calculator.evaluate",
        input: "{not-json",
      },
    ])

    // When
    const result = await provider.generate(request)

    // Then
    expect(result).toEqual({
      ok: false,
      error: {
        code: "PROVIDER_INVALID_RESPONSE",
        message: "Provider returned an invalid response",
        retryable: false,
      },
    })
  })

  it("maps unsupported finish reasons to a typed invalid-response result", async () => {
    // Given
    const provider = createScriptedProvider([{ kind: "unsupported_finish_reason" }])

    // When
    const result = await provider.generate(request)

    // Then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_INVALID_RESPONSE")
    }
  })

  it("rejects a stale tool result whose call identity does not match", async () => {
    // Given
    const provider = createScriptedProvider([{ kind: "text", text: "unused" }])

    // When
    const result = await provider.generate({
      messages: [
        { role: "user", content: "calculate" },
        {
          role: "assistant",
          content: [
            {
              kind: "tool_call",
              callId: "call_expected",
              toolName: "calculator.evaluate",
              arguments: { expression: "1 + 1" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              kind: "tool_result",
              callId: "call_stale",
              toolName: "calculator.evaluate",
              output: { value: 2 },
            },
          ],
        },
      ],
      tools: ["calculator.evaluate"],
      timeoutMs: 1_000,
    })

    // Then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("PROVIDER_INVALID_CONTINUATION")
    }
  })

  it("maps malformed application messages without invoking the model", async () => {
    // Given
    const provider = createScriptedProvider([{ kind: "text", text: "must not be consumed" }])

    // When
    const malformed = await provider.generate({ ...request, messages: [{ role: "assistant" }] })
    const valid = await provider.generate(request)

    // Then
    expect(malformed.ok ? undefined : malformed.error.code).toBe("PROVIDER_INVALID_REQUEST")
    expect(valid.ok ? valid.value.content : []).toEqual([
      { kind: "text", text: "must not be consumed" },
    ])
  })

  it("maps timeout and caller cancellation separately and permits a clean retry", async () => {
    // Given
    const provider = createScriptedProvider([
      { kind: "wait_for_abort" },
      { kind: "wait_for_abort" },
      { kind: "text", text: "clean retry" },
    ])

    // When
    const timedOut = await provider.generate({ ...request, timeoutMs: 5 })
    const controller = new AbortController()
    const cancelledPromise = provider.generate({ ...request, abortSignal: controller.signal })
    controller.abort()
    const cancelled = await cancelledPromise
    const retried = await provider.generate(request)

    // Then
    expect(timedOut.ok ? undefined : timedOut.error.code).toBe("PROVIDER_TIMEOUT")
    expect(cancelled.ok ? undefined : cancelled.error.code).toBe("PROVIDER_CANCELLED")
    expect(retried).toEqual({
      ok: true,
      value: { content: [{ kind: "text", text: "clean retry" }], finishReason: "stop" },
    })
  })

  it("uses streaming Responses transport while redacting live configuration", async () => {
    // Given
    const observedRequests: { readonly url: string; readonly body: string }[] = []
    const baseUrl = "https://provider-secret.example/v1"
    const modelId = "model-secret"
    const apiKey = "key-secret"
    const provider = createProvider(
      { mode: "openai_responses", baseUrl, modelId, apiKey },
      {
        fetch: async (input, init) => {
          observedRequests.push({ url: String(input), body: String(init?.body) })
          return new Response("provider failed", { status: 500 })
        },
      },
    )

    // When
    const result = await provider.generate({
      ...request,
      tools: [
        "skill.load",
        "calculator.evaluate",
        "notification.preview",
        "notification.send_email",
        "report.generate",
      ],
    })

    // Then
    expect(observedRequests).toHaveLength(1)
    expect(observedRequests[0]?.url).toBe(`${baseUrl}/responses`)
    expect(JSON.parse(observedRequests[0]?.body ?? "{}")).toMatchObject({
      model: modelId,
      store: false,
      parallel_tool_calls: false,
      stream: true,
      tools: [
        { name: "skill_load" },
        { name: "calculator_evaluate" },
        { name: "notification_preview" },
        { name: "notification_send_email" },
        { name: "report_generate" },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const serialized = JSON.stringify(result.error)
      expect(result.error.code).toBe("PROVIDER_FAILURE")
      expect(serialized).not.toContain(baseUrl)
      expect(serialized).not.toContain(modelId)
      expect(serialized).not.toContain(apiKey)
    }
  })
})
