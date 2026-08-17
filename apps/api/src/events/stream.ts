import {
  type CanonicalEvent,
  CanonicalEventSchema,
  type SnapshotCursor,
} from "@agentic-chat/contracts"
import { TRPCError, type TrackedEnvelope, tracked } from "@trpc/server"
import { z } from "zod"

import type { MvpActor } from "../context.js"
import type { ApiServices } from "../services.js"
import { CursorInvalidatedError, encodeTrackedCursor } from "./cursor.js"
import type { RunEventSource } from "./source.js"

type StreamOptions = {
  readonly actor: MvpActor
  readonly services: ApiServices
  readonly events: RunEventSource
  readonly input: {
    readonly runId: SnapshotCursor["runId"]
    readonly cursor?: SnapshotCursor
    readonly lastEventId?: string
  }
  readonly signal: AbortSignal | undefined
  readonly include: (event: CanonicalEvent) => boolean
}

const isTrackedEventStream = (
  value: unknown,
): value is AsyncIterable<TrackedEnvelope<CanonicalEvent>> =>
  value !== null && typeof value === "object" && Symbol.asyncIterator in value

export const TrackedEventStreamSchema =
  z.custom<AsyncIterable<TrackedEnvelope<CanonicalEvent>>>(isTrackedEventStream)

export async function* createTrackedEventStream(
  options: StreamOptions,
): AsyncGenerator<TrackedEnvelope<CanonicalEvent>> {
  const abortSignal = options.signal ?? new AbortController().signal
  let pendingSignals = 1
  let resume: (() => void) | undefined
  const wake = () => {
    pendingSignals += 1
    resume?.()
    resume = undefined
  }
  const unsubscribe = await options.events.listen(options.input.runId, wake)
  abortSignal.addEventListener("abort", wake, { once: true })
  try {
    let cursor: SnapshotCursor
    try {
      cursor = await options.services.resolveCursor(
        options.input.runId,
        options.input.cursor,
        options.input.lastEventId,
      )
    } catch (error) {
      if (error instanceof CursorInvalidatedError) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: error.message,
          cause: error,
        })
      }
      throw error
    }
    const emitted = new Set<string>()
    while (!abortSignal.aborted) {
      if (pendingSignals === 0) {
        await new Promise<void>((resolve) => {
          resume = resolve
        })
      }
      if (abortSignal.aborted) return
      pendingSignals = 0
      const batch = await options.services.events(options.actor.role, {
        runId: options.input.runId,
        afterSequence: cursor.sequence,
      })
      cursor = batch.cursor
      for (const unparsed of batch.events) {
        const event = CanonicalEventSchema.parse(unparsed)
        if (!options.include(event) || emitted.has(event.eventId)) continue
        emitted.add(event.eventId)
        yield tracked(
          encodeTrackedCursor({
            runId: event.runId,
            sequence: event.sequence,
            eventId: event.eventId,
          }),
          event,
        )
      }
    }
  } finally {
    abortSignal.removeEventListener("abort", wake)
    unsubscribe()
  }
}
