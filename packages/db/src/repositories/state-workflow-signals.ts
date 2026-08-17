import { ConflictError } from "@agentic-chat/contracts"
import { and, asc, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { dispatchIntents, runs } from "../schema/index.js"

export type PendingStateWorkflowSignal = {
  readonly intentId: string
  readonly runId: string
  readonly workflowIdentity: string
  readonly payload: JsonValue
}

export const listPendingStateWorkflowSignals = async (
  database: DatabaseClient,
): Promise<readonly PendingStateWorkflowSignal[]> => {
  const rows = await database.db
    .select({
      intentId: dispatchIntents.id,
      runId: runs.id,
      workflowIdentity: runs.workflowIdentity,
      payload: dispatchIntents.payload,
    })
    .from(dispatchIntents)
    .innerJoin(runs, eq(runs.id, dispatchIntents.aggregateId))
    .where(
      and(
        eq(dispatchIntents.status, "pending"),
        eq(dispatchIntents.topic, "state_workflow.signal"),
        eq(runs.runtime, "state_workflow"),
      ),
    )
    .orderBy(asc(dispatchIntents.createdAt), asc(dispatchIntents.id))
  return rows.flatMap((row) =>
    row.workflowIdentity === null ? [] : [{ ...row, workflowIdentity: row.workflowIdentity }],
  )
}

export const markStateWorkflowSignalDispatched = async (
  database: DatabaseClient,
  input: { readonly intentId: string; readonly dispatchedAt: Date },
): Promise<void> => {
  const updated = await database.db
    .update(dispatchIntents)
    .set({
      status: "dispatched",
      attempts: sql`${dispatchIntents.attempts} + 1`,
      dispatchedAt: input.dispatchedAt,
    })
    .where(and(eq(dispatchIntents.id, input.intentId), eq(dispatchIntents.status, "pending")))
    .returning({ id: dispatchIntents.id })
  if (updated[0]) return
  const existing = await database.db
    .select({ status: dispatchIntents.status })
    .from(dispatchIntents)
    .where(eq(dispatchIntents.id, input.intentId))
    .limit(1)
  if (existing[0]?.status !== "dispatched") {
    throw new ConflictError(`state workflow signal ${input.intentId}`)
  }
}
