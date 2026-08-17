import { ImmutableRuntimeAssignmentError, StaleVersionError } from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { dispatchIntents, runEvents, runs } from "../schema/index.js"
import type { AppendRunEventInput, RunTransitionInput } from "./types.js"

export const appendRunEvent = async (
  database: DatabaseClient,
  input: AppendRunEventInput,
): Promise<void> => {
  await database.db.insert(runEvents).values({
    id: input.eventId,
    runId: input.runId,
    sequence: input.sequence,
    type: input.type,
    visibility: input.visibility,
    payload: input.payload,
    correlationId: input.correlationId,
  })
}

export const persistRunTransition = async (
  database: DatabaseClient,
  input: RunTransitionInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await transaction
      .select({ runtime: runs.runtime, version: runs.version })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1)
    const snapshot = current[0]
    if (snapshot?.runtime !== input.runtime) {
      throw new ImmutableRuntimeAssignmentError(snapshot?.runtime ?? "missing", input.runtime)
    }
    if (snapshot.version !== input.expectedVersion) {
      throw new StaleVersionError(input.expectedVersion, snapshot.version)
    }
    const updated = await transaction
      .update(runs)
      .set({
        status: input.status,
        version: sql`${runs.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.runtime, input.runtime),
          eq(runs.version, input.expectedVersion),
        ),
      )
      .returning({ version: runs.version })
    const mutation = updated[0]
    if (!mutation) {
      const actual = await transaction
        .select({ version: runs.version })
        .from(runs)
        .where(eq(runs.id, input.runId))
        .limit(1)
      throw new StaleVersionError(input.expectedVersion, actual[0]?.version ?? -1)
    }
    await transaction.insert(runEvents).values({
      id: input.event.eventId,
      runId: input.runId,
      sequence: input.event.sequence,
      type: input.event.type,
      visibility: input.event.visibility,
      payload: input.event.payload,
      correlationId: input.event.correlationId,
    })
    await transaction.insert(dispatchIntents).values({
      id: input.dispatch.id,
      aggregateType: "run",
      aggregateId: input.runId,
      deduplicationKey: input.dispatch.deduplicationKey,
      topic: input.dispatch.topic,
      payload: input.dispatch.payload,
    })
    return mutation
  })
