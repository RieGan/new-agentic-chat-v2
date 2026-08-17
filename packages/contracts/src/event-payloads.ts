import { z } from "zod"

import { ContractErrorSchema } from "./errors.js"
import {
  AdminCommandIdSchema,
  ApprovalIdSchema,
  CallIdSchema,
  CorrelationIdSchema,
  EventIdSchema,
  EventSequenceSchema,
  JobIdSchema,
  MessageIdSchema,
  ReportIdSchema,
  RunIdSchema,
  TimestampSchema,
} from "./primitives.js"
import { SkillSnapshotSchema } from "./skills.js"
import { RunStateSchema } from "./states.js"
import { ToolNameSchema, ToolResultSchema } from "./tools.js"

export const runStatusPayload = z
  .object({ previous: RunStateSchema, current: RunStateSchema })
  .strict()
export const toolIdentityPayload = z
  .object({ callId: CallIdSchema, toolName: ToolNameSchema })
  .strict()
export const approvalRequestedPayload = z
  .object({
    approvalId: ApprovalIdSchema,
    callId: CallIdSchema,
    toolName: z.literal("notification.send_email"),
    argumentsHash: z.string().min(1),
    expiresAt: TimestampSchema,
  })
  .strict()
export const approvalDecisionPayload = z
  .object({ approvalId: ApprovalIdSchema, callId: CallIdSchema, actorId: z.literal("mvp_admin") })
  .strict()
export const jobIdentityPayload = z.object({ jobId: JobIdSchema, callId: CallIdSchema }).strict()
const adminCommandStatusPayload = z
  .object({
    commandId: AdminCommandIdSchema,
    status: z.enum(["accepted", "applied", "rejected", "expired"]),
  })
  .strict()

export const CanonicalEventPayloadSchema = z.union([
  runStatusPayload,
  SkillSnapshotSchema,
  toolIdentityPayload,
  toolIdentityPayload.extend({ approvalId: ApprovalIdSchema }),
  toolIdentityPayload.extend({ jobId: JobIdSchema }),
  toolIdentityPayload.extend({ result: ToolResultSchema }),
  toolIdentityPayload.extend({ error: ContractErrorSchema }),
  toolIdentityPayload.extend({ reason: z.string().min(1) }),
  approvalRequestedPayload,
  approvalDecisionPayload,
  approvalDecisionPayload.extend({ reason: z.string().min(1) }),
  z.object({ approvalId: ApprovalIdSchema }).strict(),
  jobIdentityPayload.extend({ status: z.literal("queued") }),
  jobIdentityPayload.extend({
    status: z.literal("running"),
    percent: z.number().int().min(0).max(100),
  }),
  jobIdentityPayload.extend({ status: z.literal("completed"), reportId: ReportIdSchema }),
  jobIdentityPayload.extend({ status: z.literal("failed"), error: ContractErrorSchema }),
  adminCommandStatusPayload,
  z
    .object({ messageId: MessageIdSchema, actor: z.enum(["user", "ai"]), content: z.string() })
    .strict(),
])

export const eventBaseShape = {
  eventId: EventIdSchema,
  runId: RunIdSchema,
  sequence: EventSequenceSchema,
  occurredAt: TimestampSchema,
  correlationId: CorrelationIdSchema,
} as const
