import { z } from "zod"

import { DuplicateError } from "./errors.js"
import { type CanonicalEvent, CanonicalEventSchema } from "./events.js"
import {
  EventIdSchema,
  EventSequenceSchema,
  RunIdSchema,
  RuntimeSchema,
  TimestampSchema,
} from "./primitives.js"

export const RuntimeDiagnosticEventSchema = z
  .object({
    eventId: EventIdSchema,
    runId: RunIdSchema,
    sequence: EventSequenceSchema,
    runtime: RuntimeSchema,
    type: z.literal("runtime.diagnostic"),
    occurredAt: TimestampSchema,
    payload: z.object({ state: z.string().min(1), detail: z.string().min(1) }).strict(),
  })
  .strict()
export type RuntimeDiagnosticEvent = z.infer<typeof RuntimeDiagnosticEventSchema>

export const ObservableEventSchema = z.union([CanonicalEventSchema, RuntimeDiagnosticEventSchema])
export type ObservableEvent = z.infer<typeof ObservableEventSchema>

export const assertOrderedEvents = (
  events: readonly CanonicalEvent[],
): readonly CanonicalEvent[] => {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]
    const current = events[index]
    if (previous !== undefined && current !== undefined && current.sequence <= previous.sequence) {
      throw new DuplicateError("run event sequence", String(current.sequence))
    }
  }
  return events
}
