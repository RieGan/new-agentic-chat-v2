import { z } from "zod"

import { CanonicalEventSchema } from "./events.js"
import {
  AggregateVersionSchema,
  ApprovalIdSchema,
  CallIdSchema,
  ConversationIdSchema,
  MessageIdSchema,
  RunIdSchema,
  SnapshotCursorSchema,
  TimestampSchema,
} from "./primitives.js"
import { RunSnapshotSchema } from "./projections.js"

export const ConversationMessageSchema = z
  .object({
    messageId: MessageIdSchema,
    runId: RunIdSchema.optional(),
    actor: z.enum(["user", "ai"]),
    content: z.string(),
    createdAt: TimestampSchema,
  })
  .strict()

export const ConversationProjectionSchema = z
  .object({
    conversationId: ConversationIdSchema,
    messages: z.array(ConversationMessageSchema),
    runs: z.array(RunSnapshotSchema),
  })
  .strict()

export const RunSubscriptionInputSchema = z
  .object({
    runId: RunIdSchema,
    cursor: SnapshotCursorSchema.optional(),
    lastEventId: z.string().min(1).optional(),
  })
  .strict()

export const RunEventBatchSchema = z
  .object({ cursor: SnapshotCursorSchema, events: z.array(CanonicalEventSchema) })
  .strict()

export const CanonicalRefetchSignalSchema = z
  .object({ action: z.literal("canonical_snapshot_refetch") })
  .strict()

const approvalDecisionBase = {
  approvalId: ApprovalIdSchema,
  callId: CallIdSchema,
  expectedArgumentsHash: z.string().min(1),
  expectedVersion: AggregateVersionSchema,
} as const

export const ApprovalApproveInputSchema = z
  .object({ ...approvalDecisionBase, decision: z.literal("approve") })
  .strict()

export const ApprovalRejectInputSchema = z
  .object({
    ...approvalDecisionBase,
    decision: z.literal("reject"),
    reason: z.string().min(1),
  })
  .strict()
