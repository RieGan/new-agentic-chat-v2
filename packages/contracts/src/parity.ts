import { z } from "zod"

import type { ObservableEvent } from "./event-observability.js"
import { CanonicalEventPayloadSchema } from "./event-payloads.js"
import type { CanonicalEvent } from "./events.js"

export const CanonicalEventTypeSchema = z.enum([
  "run.status_changed",
  "skill.loaded",
  "tool.call.started",
  "tool.call.approval_required",
  "tool.call.waiting_job",
  "tool.call.completed",
  "tool.call.failed",
  "tool.call.rejected",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
  "job.accepted",
  "job.progress",
  "job.completed",
  "job.failed",
  "admin.command.accepted",
  "admin.command.applied",
  "admin.command.rejected",
  "admin.command.expired",
  "message.completed",
])

export const NormalizedParityEventSchema = z
  .object({
    position: z.number().int().positive(),
    type: CanonicalEventTypeSchema,
    visibility: z.enum(["user", "admin", "model_only"]),
    payload: CanonicalEventPayloadSchema,
  })
  .strict()

export const NormalizedParityTraceSchema = z
  .object({ events: z.array(NormalizedParityEventSchema) })
  .strict()
export type NormalizedParityTrace = z.infer<typeof NormalizedParityTraceSchema>

const isCanonicalEvent = (event: ObservableEvent): event is CanonicalEvent =>
  event.type !== "runtime.diagnostic"

export const normalizeParityTrace = (events: readonly ObservableEvent[]): NormalizedParityTrace =>
  NormalizedParityTraceSchema.parse({
    events: events.filter(isCanonicalEvent).map((event, index) => ({
      position: index + 1,
      type: event.type,
      visibility: event.visibility,
      payload: event.payload,
    })),
  })
