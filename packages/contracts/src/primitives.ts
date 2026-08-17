import { z } from "zod"

const opaqueIdentifier = z.string().trim().min(1).max(128)

export const ActorIdSchema = opaqueIdentifier.brand("ActorId")
export const AdminCommandIdSchema = opaqueIdentifier.brand("AdminCommandId")
export const ApprovalIdSchema = opaqueIdentifier.brand("ApprovalId")
export const CallIdSchema = opaqueIdentifier.brand("CallId")
export const CommandIdSchema = opaqueIdentifier.brand("CommandId")
export const ConversationIdSchema = opaqueIdentifier.brand("ConversationId")
export const CorrelationIdSchema = opaqueIdentifier.brand("CorrelationId")
export const EventIdSchema = opaqueIdentifier.brand("EventId")
export const IdempotencyKeySchema = opaqueIdentifier.brand("IdempotencyKey")
export const JobIdSchema = opaqueIdentifier.brand("JobId")
export const MessageIdSchema = opaqueIdentifier.brand("MessageId")
export const PreviewIdSchema = opaqueIdentifier.brand("PreviewId")
export const ReportIdSchema = opaqueIdentifier.brand("ReportId")
export const RunIdSchema = opaqueIdentifier.brand("RunId")
export const SkillIdSchema = opaqueIdentifier.brand("SkillId")
export const SkillVersionSchema = opaqueIdentifier.brand("SkillVersion")
export const ToolVersionSchema = opaqueIdentifier.brand("ToolVersion")

export type ActorId = z.infer<typeof ActorIdSchema>
export type AdminCommandId = z.infer<typeof AdminCommandIdSchema>
export type ApprovalId = z.infer<typeof ApprovalIdSchema>
export type CallId = z.infer<typeof CallIdSchema>
export type CommandId = z.infer<typeof CommandIdSchema>
export type ConversationId = z.infer<typeof ConversationIdSchema>
export type CorrelationId = z.infer<typeof CorrelationIdSchema>
export type EventId = z.infer<typeof EventIdSchema>
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>
export type JobId = z.infer<typeof JobIdSchema>
export type MessageId = z.infer<typeof MessageIdSchema>
export type RunId = z.infer<typeof RunIdSchema>

export const TimestampSchema = z.iso.datetime({ offset: true })
export const AggregateVersionSchema = z.number().int().nonnegative()
export const EventSequenceSchema = z.number().int().positive()
export const CursorSequenceSchema = z.number().int().nonnegative()

export const RuntimeSchema = z.enum(["simple_loop", "state_workflow"])
export type Runtime = z.infer<typeof RuntimeSchema>

export const VisibilitySchema = z.enum(["user", "admin", "model_only", "internal"])
export type Visibility = z.infer<typeof VisibilitySchema>

export const FIXED_ACTORS = {
  USER: { id: "mvp_user", role: "user" },
  ADMIN: { id: "mvp_admin", role: "admin" },
  AI: { id: "ai", role: "ai" },
  TOOL_RUNTIME: { id: "tool_runtime", role: "tool_runtime" },
} as const

export const ActorRoleSchema = z.enum(["user", "admin", "ai", "tool_runtime"])
export const ActorSchema = z.discriminatedUnion("role", [
  z.object({ id: z.literal("mvp_user"), role: z.literal("user") }).strict(),
  z.object({ id: z.literal("mvp_admin"), role: z.literal("admin") }).strict(),
  z.object({ id: z.literal("ai"), role: z.literal("ai") }).strict(),
  z.object({ id: z.literal("tool_runtime"), role: z.literal("tool_runtime") }).strict(),
])
export type Actor = z.infer<typeof ActorSchema>

export const SnapshotCursorSchema = z
  .object({
    runId: RunIdSchema,
    sequence: CursorSequenceSchema,
    eventId: EventIdSchema.optional(),
  })
  .strict()
export type SnapshotCursor = z.infer<typeof SnapshotCursorSchema>
