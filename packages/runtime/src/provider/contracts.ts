import {
  AiToolCallRequestSchema,
  AiToolNameSchema,
  CalculatorArgumentsSchema,
  CallIdSchema,
  NotificationPreviewArgumentsSchema,
  NotificationSendArgumentsSchema,
  ReportGenerateArgumentsSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

export const ProviderSkillLoadArgumentsSchema = z
  .object({ skillId: z.string().trim().min(1), version: z.string().trim().min(1) })
  .strict()

export const ProviderToolCallSchema = z.discriminatedUnion("toolName", [
  z
    .object({
      kind: z.literal("tool_call"),
      callId: CallIdSchema,
      toolName: z.literal("skill.load"),
      arguments: ProviderSkillLoadArgumentsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_call"),
      callId: CallIdSchema,
      toolName: z.literal("calculator.evaluate"),
      arguments: CalculatorArgumentsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_call"),
      callId: CallIdSchema,
      toolName: z.literal("notification.preview"),
      arguments: NotificationPreviewArgumentsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_call"),
      callId: CallIdSchema,
      toolName: z.literal("notification.send_email"),
      arguments: NotificationSendArgumentsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_call"),
      callId: CallIdSchema,
      toolName: z.literal("report.generate"),
      arguments: ReportGenerateArgumentsSchema,
    })
    .strict(),
])

export const ProviderToolResultSchema = z
  .object({
    kind: z.literal("tool_result"),
    callId: CallIdSchema,
    toolName: z.union([z.literal("skill.load"), AiToolNameSchema]),
    output: z.json(),
  })
  .strict()

export const ProviderMessageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string().min(1) }).strict(),
  z.object({ role: z.literal("user"), content: z.string().min(1) }).strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z
        .array(
          z.union([
            z.object({ kind: z.literal("text"), text: z.string() }).strict(),
            ProviderToolCallSchema,
          ]),
        )
        .min(1),
    })
    .strict(),
  z.object({ role: z.literal("tool"), content: z.array(ProviderToolResultSchema).min(1) }).strict(),
])

export const ProviderRequestSchema = z
  .object({
    messages: z.array(ProviderMessageSchema).min(1),
    tools: z.array(z.union([z.literal("skill.load"), AiToolNameSchema])),
    timeoutMs: z.number().int().positive(),
    abortSignal: z.instanceof(AbortSignal).optional(),
  })
  .strict()

export const ScriptedProviderStepSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("text"), text: z.string(), reasoning: z.string().optional() })
    .strict(),
  z
    .object({ kind: z.literal("tool_calls"), calls: z.array(AiToolCallRequestSchema).min(1) })
    .strict(),
  z
    .object({
      kind: z.literal("skill_load"),
      callId: CallIdSchema,
      skillId: z.string().trim().min(1),
      version: z.string().trim().min(1),
    })
    .strict(),
  z.object({ kind: z.literal("provider_failure") }).strict(),
  z
    .object({
      kind: z.literal("raw_tool_call"),
      callId: z.string().min(1),
      toolName: z.string().min(1),
      input: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("unsupported_finish_reason") }).strict(),
  z.object({ kind: z.literal("wait_for_abort") }).strict(),
])

export type ProviderRequest = z.infer<typeof ProviderRequestSchema>
export type ProviderMessage = z.infer<typeof ProviderMessageSchema>
export type ProviderToolCall = z.infer<typeof ProviderToolCallSchema>
export type ScriptedProviderStep = z.infer<typeof ScriptedProviderStepSchema>

export type ProviderError = {
  readonly code:
    | "PROVIDER_INVALID_REQUEST"
    | "PROVIDER_INVALID_CONTINUATION"
    | "PROVIDER_INVALID_RESPONSE"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_CANCELLED"
    | "PROVIDER_FAILURE"
  readonly message: string
  readonly retryable: boolean
  readonly toolName?: string
}

export type ProviderGeneration = {
  readonly content: readonly ({ readonly kind: "text"; readonly text: string } | ProviderToolCall)[]
  readonly finishReason: "stop" | "tool_calls" | "length" | "content_filter"
}

export type ProviderResult =
  | { readonly ok: true; readonly value: ProviderGeneration }
  | { readonly ok: false; readonly error: ProviderError }

export interface ModelProvider {
  generate(input: unknown): Promise<ProviderResult>
}
