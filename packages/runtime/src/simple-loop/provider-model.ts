import { InvalidSchemaError, parseContract } from "@agentic-chat/contracts"
import { z } from "zod"

import {
  type ModelProvider,
  type ProviderMessage,
  ProviderMessageSchema,
  type ProviderResult,
} from "../provider/contracts.js"

const promptSchema = z.array(
  z.discriminatedUnion("role", [
    z.looseObject({ role: z.literal("system"), content: z.string() }),
    z
      .object({
        role: z.literal("user"),
        content: z.array(z.looseObject({ type: z.literal("text"), text: z.string() })),
      })
      .loose(),
    z
      .object({
        role: z.literal("assistant"),
        content: z.array(
          z.union([
            z.looseObject({ type: z.literal("text"), text: z.string() }),
            z
              .object({
                type: z.literal("tool-call"),
                toolCallId: z.string(),
                toolName: z.string(),
                input: z.unknown(),
              })
              .loose(),
          ]),
        ),
      })
      .loose(),
    z
      .object({
        role: z.literal("tool"),
        content: z.array(
          z
            .object({
              type: z.literal("tool-result"),
              toolCallId: z.string(),
              toolName: z.string(),
              output: z.discriminatedUnion("type", [
                z.looseObject({ type: z.literal("json"), value: z.json() }),
                z.looseObject({ type: z.literal("text"), value: z.string() }),
                z.looseObject({ type: z.literal("error-json"), value: z.json() }),
                z.looseObject({ type: z.literal("error-text"), value: z.string() }),
                z.looseObject({
                  type: z.literal("execution-denied"),
                  reason: z.string().optional(),
                }),
              ]),
            })
            .loose(),
        ),
      })
      .loose(),
  ]),
)

const toProviderMessages = (input: unknown): ProviderMessage[] => {
  const prompt = promptSchema.parse(input)
  return prompt.map((message) => {
    switch (message.role) {
      case "system":
        return parseContract(ProviderMessageSchema, { role: "system", content: message.content })
      case "user":
        return parseContract(ProviderMessageSchema, {
          role: "user",
          content: message.content.map((part) => part.text).join(""),
        })
      case "assistant":
        return parseContract(ProviderMessageSchema, {
          role: "assistant",
          content: message.content.map((part) =>
            part.type === "text"
              ? { kind: "text", text: part.text }
              : {
                  kind: "tool_call",
                  callId: part.toolCallId,
                  toolName: part.toolName,
                  arguments: part.input,
                },
          ),
        })
      case "tool":
        return parseContract(ProviderMessageSchema, {
          role: "tool",
          content: message.content.map((part) => ({
            kind: "tool_result",
            callId: part.toolCallId,
            toolName: part.toolName,
            output:
              part.output.type === "json" || part.output.type === "error-json"
                ? part.output.value
                : part.output.type === "execution-denied"
                  ? { error: part.output.reason ?? "execution denied" }
                  : { text: part.output.value },
          })),
        })
      default: {
        const exhaustiveMessage: never = message
        return exhaustiveMessage
      }
    }
  })
}

export class ProviderBoundaryFailure extends Error {
  readonly name = "ProviderBoundaryFailure"

  constructor(readonly result: Extract<ProviderResult, { readonly ok: false }>) {
    super(result.error.message)
  }
}

const toFinishReason = (reason: "stop" | "tool_calls" | "length" | "content_filter") => {
  switch (reason) {
    case "stop":
    case "length":
      return reason
    case "tool_calls":
      return "tool-calls" as const
    case "content_filter":
      return "content-filter" as const
    default: {
      const exhaustiveReason: never = reason
      return exhaustiveReason
    }
  }
}

type ModelHooks = {
  readonly beforeGenerate: (
    messages: readonly ProviderMessage[],
  ) => Promise<readonly ProviderMessage[] | undefined>
  readonly afterGenerate?: () => void
}

export const createProviderLanguageModel = (
  provider: ModelProvider,
  hooks: ModelHooks,
  timeoutMs: number,
) => ({
  specificationVersion: "v4" as const,
  provider: "application-provider-boundary",
  modelId: "application-provider-boundary",
  supportedUrls: {},
  doGenerate: async (options: {
    readonly prompt: unknown
    readonly tools?: readonly { readonly name: string }[]
    readonly abortSignal?: AbortSignal
  }) => {
    const messages = toProviderMessages(options.prompt)
    const preparedMessages = (await hooks.beforeGenerate(messages)) ?? messages
    const result = await provider.generate({
      messages: preparedMessages,
      tools: options.tools?.map((tool) => tool.name) ?? [],
      timeoutMs,
      ...(options.abortSignal === undefined ? {} : { abortSignal: options.abortSignal }),
    })
    if (!result.ok) throw new ProviderBoundaryFailure(result)
    hooks.afterGenerate?.()
    return {
      content: result.value.content.map((part) =>
        part.kind === "text"
          ? { type: "text" as const, text: part.text }
          : {
              type: "tool-call" as const,
              toolCallId: part.callId,
              toolName: part.toolName,
              input: JSON.stringify(part.arguments),
            },
      ),
      finishReason: { unified: toFinishReason(result.value.finishReason), raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }
  },
  doStream: async () => {
    throw new InvalidSchemaError(["streaming is disabled for Simple Loop"])
  },
})
