import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai"
import {
  generateText,
  InvalidResponseDataError,
  InvalidToolInputError,
  JSONParseError,
  type LanguageModel,
  MissingToolResultsError,
  NoSuchToolError,
  streamText,
  TypeValidationError,
} from "ai"
import { ZodError } from "zod"

import {
  type ProviderError,
  type ProviderGeneration,
  type ProviderMessage,
  type ProviderRequest,
  ProviderRequestSchema,
  type ProviderResult,
  type ProviderToolCall,
  ProviderToolCallSchema,
} from "./contracts.js"
import { toModelMessage } from "./messages.js"
import {
  fromLanguageModelToolName,
  type ProviderTransport,
  providerToolsFor,
  toLanguageModelToolName,
} from "./tools.js"

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

const mapToolCall = (
  part: {
    readonly toolCallId: string
    readonly toolName: string
    readonly input: unknown
  },
  transport: ProviderTransport,
): ProviderToolCall | undefined => {
  const toolName = fromLanguageModelToolName(part.toolName, transport)
  if (toolName === undefined) return undefined
  const parsed = ProviderToolCallSchema.safeParse({
    kind: "tool_call",
    callId: part.toolCallId,
    toolName,
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

export const createAiSdkProvider = (model: LanguageModel, transport: ProviderTransport) => ({
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
      const generationOptions = {
        model,
        messages: request.messages
          .filter((message) => message.role !== "system")
          .map((message) => toModelMessage(message, transport)),
        ...(instructions === "" ? {} : { instructions }),
        tools: providerToolsFor(transport),
        activeTools: request.tools.map((toolName) => toLanguageModelToolName(toolName, transport)),
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
      }
      const generation =
        transport === "stream" ? streamText(generationOptions) : generateText(generationOptions)
      const generated = await generation
      const result = {
        content: await generated.content,
        finishReason: await generated.finishReason,
      }
      const finishReason = mapFinishReason(result.finishReason)
      if (finishReason === undefined) {
        return error("PROVIDER_INVALID_RESPONSE", "Provider returned an invalid response", false)
      }
      const content: Array<ProviderToolCall | { readonly kind: "text"; readonly text: string }> = []
      for (const part of result.content) {
        if (part.type === "text") {
          content.push({ kind: "text", text: part.text })
        } else if (part.type === "tool-call") {
          const toolCall = mapToolCall(part, transport)
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
