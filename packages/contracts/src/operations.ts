import { z } from "zod"

import { ContractErrorSchema } from "./errors.js"
import {
  AdminCommandIdSchema,
  AggregateVersionSchema,
  ApprovalIdSchema,
  CallIdSchema,
  ConversationIdSchema,
  IdempotencyKeySchema,
  JobIdSchema,
  ReportIdSchema,
  RunIdSchema,
  TimestampSchema,
} from "./primitives.js"
import { NotificationSendArgumentsSchema, ToolNameSchema } from "./tools.js"

const approvalBaseShape = {
  approvalId: ApprovalIdSchema,
  runId: RunIdSchema,
  callId: CallIdSchema,
  toolName: z.literal("notification.send_email"),
  arguments: NotificationSendArgumentsSchema,
  argumentsHash: z.string().min(1),
  requiredActor: z.literal("mvp_admin"),
  expiresAt: TimestampSchema,
  version: AggregateVersionSchema,
} as const

export const ApprovalEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({ ...approvalBaseShape, status: z.literal("pending") }).strict(),
  z
    .object({
      ...approvalBaseShape,
      status: z.literal("approved"),
      decidedBy: z.literal("mvp_admin"),
      decidedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      ...approvalBaseShape,
      status: z.literal("rejected"),
      decidedBy: z.literal("mvp_admin"),
      decidedAt: TimestampSchema,
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({ ...approvalBaseShape, status: z.literal("expired"), expiredAt: TimestampSchema })
    .strict(),
])
export type ApprovalEnvelope = z.infer<typeof ApprovalEnvelopeSchema>

const jobBaseShape = {
  jobId: JobIdSchema,
  runId: RunIdSchema,
  callId: CallIdSchema,
  version: AggregateVersionSchema,
} as const

export const JobEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({ ...jobBaseShape, status: z.literal("queued") }).strict(),
  z
    .object({
      ...jobBaseShape,
      status: z.literal("running"),
      percent: z.number().int().min(0).max(100),
    })
    .strict(),
  z
    .object({
      ...jobBaseShape,
      status: z.literal("completed"),
      reportId: ReportIdSchema,
    })
    .strict(),
  z.object({ ...jobBaseShape, status: z.literal("failed"), error: ContractErrorSchema }).strict(),
])
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>

const adminCommandBaseShape = {
  commandId: AdminCommandIdSchema,
  conversationId: ConversationIdSchema,
  actorId: z.literal("mvp_admin"),
  instruction: z.string().min(1).max(16_000),
  visibility: z.literal("model_only"),
  expiresAt: TimestampSchema,
  idempotencyKey: IdempotencyKeySchema,
  version: AggregateVersionSchema,
} as const

export const AdminCommandEnvelopeSchema = z.discriminatedUnion("status", [
  z.object({ ...adminCommandBaseShape, status: z.literal("accepted") }).strict(),
  z
    .object({
      ...adminCommandBaseShape,
      status: z.literal("applied"),
      appliedRunId: RunIdSchema,
      appliedAt: TimestampSchema,
    })
    .strict(),
  z
    .object({
      ...adminCommandBaseShape,
      status: z.literal("rejected"),
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({ ...adminCommandBaseShape, status: z.literal("expired"), expiredAt: TimestampSchema })
    .strict(),
])
export type AdminCommandEnvelope = z.infer<typeof AdminCommandEnvelopeSchema>

export const ToolDefinitionSchema = z
  .object({
    name: ToolNameSchema,
    version: z.string().trim().min(1),
    mode: z.enum(["sync", "async"]),
    risk: z.enum(["read", "low", "high"]),
    approvalRequired: z.boolean(),
  })
  .strict()
