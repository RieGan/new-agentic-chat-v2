import { CallIdSchema, PreviewIdSchema } from "@agentic-chat/contracts"

import {
  type ModelProvider,
  type ProviderGeneration,
  ProviderRequestSchema,
  type ProviderResult,
} from "./provider/contracts.js"

const scenarioFrom = (
  message: string,
): { readonly kind: "report" | "approval"; readonly id: string } => {
  const matched = /^TASK18 (report|approval) ([a-z0-9_-]+)$/.exec(message)
  if (!matched?.[1] || !matched[2]) throw new TypeError("Invalid Task 18 Compose prompt")
  return { kind: matched[1] === "report" ? "report" : "approval", id: matched[2] }
}

const generated = (content: ProviderGeneration["content"]): ProviderResult => ({
  ok: true,
  value: {
    content,
    finishReason: content.some((entry) => entry.kind === "tool_call") ? "tool_calls" : "stop",
  },
})

export const createComposeDeterministicProvider = (): ModelProvider => ({
  generate: async (input) => {
    const request = ProviderRequestSchema.parse(input)
    const userMessage = request.messages.find((message) => message.role === "user")
    if (userMessage?.role !== "user")
      throw new TypeError("Task 18 provider requires a User message")
    const scenario = scenarioFrom(userMessage.content)
    const results = request.messages.flatMap((message) =>
      message.role === "tool" ? message.content : [],
    )

    if (!results.some((result) => result.toolName === "skill.load")) {
      return generated([
        {
          kind: "tool_call",
          callId: CallIdSchema.parse(`call_skill_${scenario.id}`),
          toolName: "skill.load",
          arguments: {
            skillId: scenario.kind === "report" ? "report_assistant" : "communication_assistant",
            version: "1",
          },
        },
      ])
    }
    if (scenario.kind === "report") {
      if (!results.some((result) => result.toolName === "report.generate")) {
        return generated([
          {
            kind: "tool_call",
            callId: CallIdSchema.parse(`call_report_${scenario.id}`),
            toolName: "report.generate",
            arguments: { topic: "quarterly", sections: ["summary"] },
          },
        ])
      }
      return generated([{ kind: "text", text: "Report report_001 is complete." }])
    }
    if (!results.some((result) => result.toolName === "notification.preview")) {
      return generated([
        {
          kind: "tool_call",
          callId: CallIdSchema.parse(`call_preview_${scenario.id}`),
          toolName: "notification.preview",
          arguments: { recipient: "qa@example.com", subject: "MVP", body: "Approval" },
        },
      ])
    }
    if (!results.some((result) => result.toolName === "notification.send_email")) {
      return generated([
        {
          kind: "tool_call",
          callId: CallIdSchema.parse(`call_send_${scenario.id}`),
          toolName: "notification.send_email",
          arguments: { previewId: PreviewIdSchema.parse(`preview_call_preview_${scenario.id}`) },
        },
      ])
    }
    return generated([{ kind: "text", text: `Message message_call_send_${scenario.id} was sent.` }])
  },
})
