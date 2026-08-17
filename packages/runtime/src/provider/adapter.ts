import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai"
import {
  generateText,
  InvalidResponseDataError,
  InvalidToolInputError,
  JSONParseError,
  type LanguageModel,
  MissingToolResultsError,
  type ModelMessage,
  NoSuchToolError,
  TypeValidationError,
} from "ai"
import { ZodError } from "zod"

import {
  type ModelProvider,
  type ProviderError,
  type ProviderGeneration,
  type ProviderMessage,
  type ProviderRequest,
  ProviderRequestSchema,
  type ProviderResult,
  type ProviderToolCall,
  ProviderToolCallSchema,
} from "./contracts.js"
import { providerTools } from "./tools.js"

const error = (
  code: ProviderError["code"],
  message: string,
  retryable: boolean,
  toolName?: string,
): ProviderResult => ({
  ok: false,
  error: { code, message, retryable, ...(toolName === undefined ? {} : { toolName }) },
})

const hasValidContinuation = (messages: readonly ProviderMessage[]): boolean => {
  const pending = new Map<string, string>()
  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "user":
        if (pending.size > 0) return false
        break
      case "assistant":
        for (const part of message.content) {
          if (part.kind === "tool_call") {
            if (pending.has(part.callId)) return false
            pending.set(part.callId, part.toolName)
          }
        }
        break
      case "tool":
        for (const part of message.content) {
          if (pending.get(part.callId) !== part.toolName) return false
          pending.delete(part.callId)
        }
        break
      default: {
        const exhaustiveMessage: never = message
        return exhaustiveMessage
      }
    }
  }
  return pending.size === 0
}

const toModelMessage = (message: ProviderMessage): ModelMessage => {
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
                toolName: part.toolName,
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
          toolName: part.toolName,
          output: { type: "json" as const, value: part.output },
        })),
      }
    default: {
      const exhaustiveMessage: never = message
      return exhaustiveMessage
    }
  }
}

const mapFinishReason = (finishReason: string): ProviderGeneration["finishReason"] | undefined => {
  switch (finishReason) {
    case "stop":
    case "length":
      return finishReason
    case "tool-calls":
      return "tool_calls"
    case "content-filter":
      return "content_filter"
    case "error":
    case "other":
      return undefined
    default:
      return undefined
  }
}

const mapToolCall = (part: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: unknown
}): ProviderToolCall | undefined => {
  const parsed = ProviderToolCallSchema.safeParse({
    kind: "tool_call",
    callId: part.toolCallId,
    toolName: part.toolName,
    arguments: part.input,
  })
  return parsed.success ? parsed.data : undefined
}

const mapFailure = (caught: unknown, request: ProviderRequest): ProviderResult => {
  if (request.abortSignal?.aborted === true) {
    return error("PROVIDER_CANCELLED", "Provider request was cancelled", true)
  }
  if (caught instanceof DOMException && caught.name === "TimeoutError") {
    return error("PROVIDER_TIMEOUT", "Provider request timed out", true)
  }
  if (
    caught instanceof InvalidToolInputError ||
    caught instanceof JSONParseError ||
    caught instanceof TypeValidationError ||
    caught instanceof InvalidResponseDataError
  ) {
    return error(
      "PROVIDER_INVALID_RESPONSE",
      "Provider returned an invalid response",
      false,
      caught instanceof InvalidToolInputError ? caught.toolName : undefined,
    )
  }
  if (caught instanceof NoSuchToolError) {
    return error(
      "PROVIDER_INVALID_RESPONSE",
      "Provider returned an invalid response",
      false,
      caught.toolName,
    )
  }
  if (caught instanceof MissingToolResultsError) {
    return error("PROVIDER_INVALID_CONTINUATION", "Provider continuation is invalid", false)
  }
  return error("PROVIDER_FAILURE", "Provider request failed", true)
}

export const createAiSdkProvider = (model: LanguageModel): ModelProvider => ({
  generate: async (input: unknown): Promise<ProviderResult> => {
    const requestResult = ProviderRequestSchema.safeParse(input)
    if (!requestResult.success) {
      return error("PROVIDER_INVALID_REQUEST", "Provider request is invalid", false)
    }
    const request = requestResult.data
    if (!hasValidContinuation(request.messages)) {
      return error("PROVIDER_INVALID_CONTINUATION", "Provider continuation is invalid", false)
    }

    try {
      const instructions = request.messages
        .filter(
          (message): message is Extract<ProviderMessage, { readonly role: "system" }> =>
            message.role === "system",
        )
        .map((message) => message.content)
        .join("\n")
      const result = await generateText({
        model,
        messages: request.messages
          .filter((message) => message.role !== "system")
          .map(toModelMessage),
        ...(instructions === "" ? {} : { instructions }),
        tools: providerTools,
        activeTools: request.tools,
        maxRetries: 0,
        ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal }),
        timeout: { totalMs: request.timeoutMs, stepMs: request.timeoutMs },
        providerOptions: {
          openai: {
            store: false,
            parallelToolCalls: false,
            reasoningSummary: null,
          } satisfies OpenAILanguageModelResponsesOptions,
        },
      })
      const finishReason = mapFinishReason(result.finishReason)
      if (finishReason === undefined) {
        return error("PROVIDER_INVALID_RESPONSE", "Provider returned an invalid response", false)
      }
      const content: Array<ProviderToolCall | { readonly kind: "text"; readonly text: string }> = []
      for (const part of result.content) {
        if (part.type === "text") {
          content.push({ kind: "text", text: part.text })
        } else if (part.type === "tool-call") {
          const toolCall = mapToolCall(part)
          if (toolCall === undefined) {
            return error(
              "PROVIDER_INVALID_RESPONSE",
              "Provider returned an invalid response",
              false,
            )
          }
          content.push(toolCall)
        } else if (part.type === "tool-error") {
          return error(
            "PROVIDER_INVALID_RESPONSE",
            "Provider returned an invalid response",
            false,
            part.toolName,
          )
        }
      }
      return { ok: true, value: { content, finishReason } }
    } catch (caught) {
      if (caught instanceof ZodError) {
        return error("PROVIDER_INVALID_RESPONSE", "Provider returned an invalid response", false)
      }
      return mapFailure(caught, request)
    }
  },
})
