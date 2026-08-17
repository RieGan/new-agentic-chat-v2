import { z } from "zod"
import { ContractErrorSchema } from "./errors.js"
import {
  approvalDecisionPayload,
  approvalRequestedPayload,
  eventBaseShape,
  jobIdentityPayload,
  runStatusPayload,
  toolIdentityPayload,
} from "./event-payloads.js"
import {
  AdminCommandIdSchema,
  ApprovalIdSchema,
  JobIdSchema,
  MessageIdSchema,
  ReportIdSchema,
} from "./primitives.js"
import { SkillSnapshotSchema } from "./skills.js"
import { isRunTransitionAllowed } from "./states.js"
import { ToolResultSchema } from "./tools.js"

export const CanonicalEventSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        ...eventBaseShape,
        type: z.literal("run.status_changed"),
        visibility: z.literal("user"),
        payload: runStatusPayload,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("skill.loaded"),
        visibility: z.literal("user"),
        payload: SkillSnapshotSchema,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.started"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.approval_required"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload.extend({ approvalId: ApprovalIdSchema }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.waiting_job"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload.extend({ jobId: JobIdSchema }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.completed"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload.extend({ result: ToolResultSchema }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.failed"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload.extend({ error: ContractErrorSchema }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("tool.call.rejected"),
        visibility: z.literal("user"),
        payload: toolIdentityPayload.extend({ reason: z.string().min(1) }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("approval.requested"),
        visibility: z.literal("admin"),
        payload: approvalRequestedPayload,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("approval.approved"),
        visibility: z.literal("admin"),
        payload: approvalDecisionPayload,
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("approval.rejected"),
        visibility: z.literal("admin"),
        payload: approvalDecisionPayload.extend({ reason: z.string().min(1) }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("approval.expired"),
        visibility: z.literal("admin"),
        payload: z.object({ approvalId: ApprovalIdSchema }).strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("job.accepted"),
        visibility: z.literal("user"),
        payload: jobIdentityPayload.extend({ status: z.literal("queued") }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("job.progress"),
        visibility: z.literal("user"),
        payload: jobIdentityPayload.extend({
          status: z.literal("running"),
          percent: z.number().int().min(0).max(100),
        }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("job.completed"),
        visibility: z.literal("user"),
        payload: jobIdentityPayload.extend({
          status: z.literal("completed"),
          reportId: ReportIdSchema,
        }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("job.failed"),
        visibility: z.literal("user"),
        payload: jobIdentityPayload.extend({
          status: z.literal("failed"),
          error: ContractErrorSchema,
        }),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("admin.command.accepted"),
        visibility: z.literal("model_only"),
        payload: z
          .object({ commandId: AdminCommandIdSchema, status: z.literal("accepted") })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("admin.command.applied"),
        visibility: z.literal("model_only"),
        payload: z
          .object({ commandId: AdminCommandIdSchema, status: z.literal("applied") })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("admin.command.rejected"),
        visibility: z.literal("admin"),
        payload: z
          .object({
            commandId: AdminCommandIdSchema,
            status: z.literal("rejected"),
            reason: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("admin.command.expired"),
        visibility: z.literal("admin"),
        payload: z
          .object({ commandId: AdminCommandIdSchema, status: z.literal("expired") })
          .strict(),
      })
      .strict(),
    z
      .object({
        ...eventBaseShape,
        type: z.literal("message.completed"),
        visibility: z.literal("user"),
        payload: z
          .object({
            messageId: MessageIdSchema,
            actor: z.enum(["user", "ai"]),
            content: z.string(),
          })
          .strict(),
      })
      .strict(),
  ])
  .superRefine((event, context) => {
    if (
      event.type === "run.status_changed" &&
      !isRunTransitionAllowed(event.payload.previous, event.payload.current)
    ) {
      context.addIssue({ code: "custom", message: "Illegal run status transition event" })
    }
  })
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>
