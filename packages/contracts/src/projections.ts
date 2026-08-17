import { z } from "zod"

import { ForbiddenVisibilityError } from "./errors.js"
import { type CanonicalEvent, CanonicalEventSchema } from "./events.js"
import {
  AggregateVersionSchema,
  ConversationIdSchema,
  RunIdSchema,
  RuntimeSchema,
  SnapshotCursorSchema,
} from "./primitives.js"
import { SkillSnapshotSchema } from "./skills.js"
import { LOOP_STEP_BUDGET, RunStateSchema } from "./states.js"

export const RunSnapshotSchema = z
  .object({
    runId: RunIdSchema,
    conversationId: ConversationIdSchema,
    runtime: RuntimeSchema,
    status: RunStateSchema,
    version: AggregateVersionSchema,
    consumedSteps: z.number().int().min(0).max(LOOP_STEP_BUDGET),
    selectedSkill: SkillSnapshotSchema.optional(),
    cursor: SnapshotCursorSchema,
  })
  .strict()
export type RunSnapshot = z.infer<typeof RunSnapshotSchema>

export const UserProjectionSchema = z
  .object({
    viewer: z.literal("user"),
    run: RunSnapshotSchema,
    events: z.array(CanonicalEventSchema),
  })
  .strict()
  .superRefine((projection, context) => {
    for (const event of projection.events) {
      if (event.visibility !== "user") {
        context.addIssue({ code: "custom", message: "User projection contains hidden event" })
      }
    }
  })
export type UserProjection = z.infer<typeof UserProjectionSchema>

export const AdminProjectionSchema = z
  .object({
    viewer: z.literal("admin"),
    run: RunSnapshotSchema,
    events: z.array(CanonicalEventSchema),
  })
  .strict()
export type AdminProjection = z.infer<typeof AdminProjectionSchema>

export const RunProjectionSchema = z.discriminatedUnion("viewer", [
  UserProjectionSchema,
  AdminProjectionSchema,
])

export const RunsListOutputSchema = z.array(RunSnapshotSchema)
export const RunGetOutputSchema = RunSnapshotSchema
export const RunEventsOutputSchema = z
  .object({ cursor: SnapshotCursorSchema, events: z.array(CanonicalEventSchema) })
  .strict()

type ProjectionOptions = { readonly rejectForbidden?: boolean }

export const projectEvents = (
  events: readonly CanonicalEvent[],
  viewer: "user" | "admin",
  options: ProjectionOptions = {},
): readonly CanonicalEvent[] => {
  switch (viewer) {
    case "admin":
      return events
    case "user": {
      const visible: CanonicalEvent[] = []
      for (const event of events) {
        if (event.visibility === "user") {
          visible.push(event)
        } else if (options.rejectForbidden === true) {
          throw new ForbiddenVisibilityError(event.visibility, viewer)
        }
      }
      return visible
    }
    default: {
      const exhaustiveViewer: never = viewer
      return exhaustiveViewer
    }
  }
}
