import { describe, expect, it } from "vitest"

import { createComposeDeterministicProvider } from "../src/compose-provider.js"

const continuationRequest = (output: {
  readonly toolName: "notification.send_email"
  readonly status: "sent" | "not_sent"
  readonly messageId?: string
}) => ({
  messages: [
    { role: "user", content: "TASK18 approval provider-outcome" },
    {
      role: "tool",
      content: [
        {
          kind: "tool_result",
          callId: "call_skill_provider-outcome",
          toolName: "skill.load",
          output: { skillId: "communication_assistant", version: "1" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          kind: "tool_result",
          callId: "call_preview_provider-outcome",
          toolName: "notification.preview",
          output: {
            toolName: "notification.preview",
            previewId: "preview_call_preview_provider-outcome",
          },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          kind: "tool_result",
          callId: "call_send_provider-outcome",
          toolName: "notification.send_email",
          output,
        },
      ],
    },
  ],
  tools: ["skill.load", "notification.preview", "notification.send_email"],
  timeoutMs: 1_000,
})

describe("Compose deterministic provider send outcome", () => {
  it("renders sent copy for the canonical approved send result", async () => {
    // Given
    const provider = createComposeDeterministicProvider()
    const request = continuationRequest({
      toolName: "notification.send_email",
      status: "sent",
      messageId: "message_c3271524a11745e1b6ab830b",
    })

    // When
    const result = await provider.generate(request)

    // Then
    expect(result).toEqual({
      ok: true,
      value: {
        content: [{ kind: "text", text: "Message message_call_send_provider-outcome was sent." }],
        finishReason: "stop",
      },
    })
  })

  it("renders not-sent copy for the canonical rejected send result", async () => {
    // Given
    const provider = createComposeDeterministicProvider()
    const request = continuationRequest({
      toolName: "notification.send_email",
      status: "not_sent",
    })

    // When
    const result = await provider.generate(request)

    // Then
    expect(result).toEqual({
      ok: true,
      value: {
        content: [{ kind: "text", text: "The message was not sent." }],
        finishReason: "stop",
      },
    })
  })
})
