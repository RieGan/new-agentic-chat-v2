import { ImmutableRuntimeAssignmentError, StaleVersionError } from "@agentic-chat/contracts"
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { dispatchIntents, runs } from "../schema/index.js"

export type ClaimedRunRecord = {
  readonly runId: string
  readonly owner: string
  readonly fencingVersion: number
  readonly version: number
  readonly expiresAt: Date
}

export type PendingWorkflowStartRecord = {
  readonly intentId: string
  readonly runId: string
  readonly runtime: "state_workflow"
  readonly workflowIdentity: string
  readonly payload: JsonValue
}

export const claimNextSimpleLoopRun = async (
  database: DatabaseClient,
  input: { readonly owner: string; readonly durationSeconds: number },
): Promise<ClaimedRunRecord | null> =>
  database.db.transaction(async (transaction) => {
    const candidates = await transaction
      .select({ id: runs.id, version: runs.version })
      .from(runs)
      .where(
        and(
          eq(runs.runtime, "simple_loop"),
          inArray(runs.status, ["queued", "running"]),
          or(isNull(runs.leaseOwner), lt(runs.leaseExpiresAt, new Date())),
        ),
      )
      .orderBy(asc(runs.updatedAt), asc(runs.id))
      .for("update", { skipLocked: true })
      .limit(1)
    const candidate = candidates[0]
    if (!candidate) return null
    const claimed = await transaction
      .update(runs)
      .set({
        leaseOwner: input.owner,
        leaseExpiresAt: sql`now() + (${input.durationSeconds} * interval '1 second')`,
        fencingVersion: sql`${runs.fencingVersion} + 1`,
        version: sql`${runs.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(runs.id, candidate.id),
          eq(runs.runtime, "simple_loop"),
          eq(runs.version, candidate.version),
        ),
      )
      .returning({
        runId: runs.id,
        owner: runs.leaseOwner,
        fencingVersion: runs.fencingVersion,
        version: runs.version,
        expiresAt: runs.leaseExpiresAt,
      })
    const lease = claimed[0]
    if (!lease?.owner || !lease.expiresAt) {
      throw new StaleVersionError(candidate.version, candidate.version + 1)
    }
    return {
      runId: lease.runId,
      owner: lease.owner,
      fencingVersion: lease.fencingVersion,
      version: lease.version,
      expiresAt: lease.expiresAt,
    }
  })

export const readRunAssignment = async (
  database: DatabaseClient,
  runId: string,
): Promise<{ readonly runtime: "simple_loop" | "state_workflow"; readonly version: number }> => {
  const rows = await database.db
    .select({ runtime: runs.runtime, version: runs.version })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1)
  const assignment = rows[0]
  if (!assignment) throw new ImmutableRuntimeAssignmentError("missing", "simple_loop")
  return assignment
}

export const listPendingWorkflowStarts = async (
  database: DatabaseClient,
): Promise<readonly PendingWorkflowStartRecord[]> => {
  const rows = await database.db
    .select({
      intentId: dispatchIntents.id,
      runId: runs.id,
      runtime: runs.runtime,
      workflowIdentity: runs.workflowIdentity,
      payload: dispatchIntents.payload,
    })
    .from(dispatchIntents)
    .innerJoin(runs, eq(runs.id, dispatchIntents.aggregateId))
    .where(
      and(
        eq(dispatchIntents.status, "pending"),
        eq(dispatchIntents.topic, "state_workflow.start"),
        eq(runs.runtime, "state_workflow"),
      ),
    )
    .orderBy(asc(dispatchIntents.createdAt), asc(dispatchIntents.id))
  return rows.flatMap((row) =>
    row.runtime === "state_workflow" && row.workflowIdentity
      ? [{ ...row, runtime: row.runtime, workflowIdentity: row.workflowIdentity }]
      : [],
  )
}

export const listPendingDispatches = async (
  database: DatabaseClient,
): Promise<
  readonly { readonly intentId: string; readonly topic: string; readonly payload: JsonValue }[]
> =>
  database.db
    .select({
      intentId: dispatchIntents.id,
      topic: dispatchIntents.topic,
      payload: dispatchIntents.payload,
    })
    .from(dispatchIntents)
    .where(and(eq(dispatchIntents.status, "pending"), sql`${dispatchIntents.availableAt} <= now()`))
    .orderBy(asc(dispatchIntents.createdAt), asc(dispatchIntents.id))
