import type { ModelMessage } from "ai"

import type { ProviderMessage } from "./contracts.js"
import { type ProviderTransport, toLanguageModelToolName } from "./tools.js"

export const toModelMessage = (
  message: ProviderMessage,
  transport: ProviderTransport,
): ModelMessage => {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content }
    case "assistant":
      return {
        role: "assistant",
        content: message.content.map((part) => {
          switch (part.kind) {
            case "text":
              return { type: "text" as const, text: part.text }
            case "tool_call":
              return {
                type: "tool-call" as const,
                toolCallId: part.callId,
                toolName: toLanguageModelToolName(part.toolName, transport),
                input: part.arguments,
              }
            default: {
              const exhaustivePart: never = part
              return exhaustivePart
            }
          }
        }),
      }
    case "tool":
      return {
        role: "tool",
        content: message.content.map((part) => ({
          type: "tool-result" as const,
          toolCallId: part.callId,
          toolName: toLanguageModelToolName(part.toolName, transport),
          output: { type: "json" as const, value: part.output },
        })),
      }
    default: {
      const exhaustiveMessage: never = message
      return exhaustiveMessage
    }
  }
}
