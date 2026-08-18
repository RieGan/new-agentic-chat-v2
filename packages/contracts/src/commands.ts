import { z } from "zod"

import {
  AggregateVersionSchema,
  ApprovalIdSchema,
  CallIdSchema,
  CommandIdSchema,
  ConversationIdSchema,
  CorrelationIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  RunIdSchema,
  RuntimeSchema,
  SkillIdSchema,
  SkillVersionSchema,
  TimestampSchema,
} from "./primitives.js"
import { RunStateSchema } from "./states.js"

const messageSchema = z.string().min(1).max(32_000)

export const ChatSendMessageInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("new_run"),
      conversationId: ConversationIdSchema,
      runtime: RuntimeSchema,
      message: messageSchema,
      idempotencyKey: IdempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("continue_run"),
      conversationId: ConversationIdSchema,
      runId: RunIdSchema,
      boundary: z.literal("waiting_for_user"),
      correlationId: CorrelationIdSchema,
      message: messageSchema,
      idempotencyKey: IdempotencyKeySchema,
    })
    .strict(),
])
export type ChatSendMessageInput = z.infer<typeof ChatSendMessageInputSchema>

export const AdminCommandInputSchema = z
  .object({
    conversationId: ConversationIdSchema,
    instruction: z.string().min(1).max(16_000),
    expiresAt: TimestampSchema,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict()
export type AdminCommandInput = z.infer<typeof AdminCommandInputSchema>

export const ApprovalDecisionInputSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("approve"),
      approvalId: ApprovalIdSchema,
      callId: CallIdSchema,
      expectedArgumentsHash: z.string().min(1),
      expectedVersion: AggregateVersionSchema,
    })
    .strict(),
  z
    .object({
      decision: z.literal("reject"),
      approvalId: ApprovalIdSchema,
      callId: CallIdSchema,
      expectedArgumentsHash: z.string().min(1),
      expectedVersion: AggregateVersionSchema,
      reason: z.string().min(1),
    })
    .strict(),
])
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>

export const ResumeRunCommandSchema = z.discriminatedUnion("reason", [
  z
    .object({
      reason: z.literal("tool_completed"),
      runId: RunIdSchema,
      callId: CallIdSchema,
      jobId: JobIdSchema,
      correlationId: CorrelationIdSchema,
    })
    .strict(),
  z
    .object({
      reason: z.literal("approval_decided"),
      runId: RunIdSchema,
      callId: CallIdSchema,
      approvalId: ApprovalIdSchema,
      correlationId: CorrelationIdSchema,
    })
    .strict(),
  z
    .object({
      reason: z.literal("user_continuation"),
      runId: RunIdSchema,
      boundary: z.literal("waiting_for_user"),
      correlationId: CorrelationIdSchema,
    })
    .strict(),
  z
    .object({
      reason: z.literal("runtime_restart"),
      runId: RunIdSchema,
      callId: CallIdSchema,
      jobId: JobIdSchema,
      correlationId: CorrelationIdSchema,
    })
    .strict(),
])
export type ResumeRunCommand = z.infer<typeof ResumeRunCommandSchema>

const commandBaseShape = {
  commandId: CommandIdSchema,
  createdAt: TimestampSchema,
} as const

export const CommandEnvelopeSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...commandBaseShape,
      type: z.literal("chat.send_message"),
      actorId: z.literal("mvp_user"),
      payload: ChatSendMessageInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("admin.command.send_hidden"),
      actorId: z.literal("mvp_admin"),
      payload: AdminCommandInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("approval.decide"),
      actorId: z.literal("mvp_admin"),
      payload: ApprovalDecisionInputSchema,
    })
    .strict(),
  z
    .object({
      ...commandBaseShape,
      type: z.literal("run.resume"),
      actorId: z.literal("tool_runtime"),
      payload: ResumeRunCommandSchema,
    })
    .strict(),
])
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>

export const CommandAcceptedOutputSchema = z
  .object({ commandId: CommandIdSchema, status: z.literal("accepted"), runId: RunIdSchema })
  .strict()

export const ConversationGetInputSchema = z
  .object({ conversationId: ConversationIdSchema })
  .strict()
export const ConversationCreateInputSchema = z
  .object({ conversationId: ConversationIdSchema })
  .strict()
export const ConversationsListInputSchema = z.object({}).strict()
export const RunsListInputSchema = z
  .object({ runtime: RuntimeSchema.optional(), status: RunStateSchema.optional() })
  .strict()
export const RunGetInputSchema = z.object({ runId: RunIdSchema }).strict()
export const RunEventsInputSchema = z
  .object({ runId: RunIdSchema, afterSequence: z.number().int().nonnegative().optional() })
  .strict()
export const ApprovalListPendingInputSchema = z.object({ runId: RunIdSchema.optional() }).strict()
export const ApprovalGetInputSchema = z.object({ approvalId: ApprovalIdSchema }).strict()
export const JobGetInputSchema = z.object({ jobId: JobIdSchema }).strict()
export const SkillGetInputSchema = z
  .object({ skillId: SkillIdSchema, version: SkillVersionSchema })
  .strict()
