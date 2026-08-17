import {
  ConflictError,
  ImmutableRuntimeAssignmentError,
  type RunState,
  type Runtime,
  StaleLeaseError,
  StaleVersionError,
} from "@agentic-chat/contracts"
import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { dispatchIntents, runEvents, runs } from "../schema/index.js"
import type { LeasedRunTransitionInput } from "./types.js"

export type ClaimRunLeaseInput = {
  readonly runId: string
  readonly runtime: Runtime
  readonly owner: string
  readonly expectedVersion: number
  readonly durationSeconds: number
}

export type RunLease = {
  readonly owner: string
  readonly fencingVersion: number
  readonly version: number
  readonly expiresAt: Date
}

export type LeaseMutationInput = {
  readonly runId: string
  readonly owner: string
  readonly fencingVersion: number
  readonly expectedVersion: number
  readonly status: RunState
}

export const claimRunLease = async (
  database: DatabaseClient,
  input: ClaimRunLeaseInput,
): Promise<RunLease> =>
  database.db.transaction(async (transaction) => {
    const selected = await transaction
      .select({ runtime: runs.runtime, status: runs.status, version: runs.version })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1)
    const current = selected[0]
    if (current?.runtime !== input.runtime) {
      throw new ImmutableRuntimeAssignmentError(current?.runtime ?? "missing", input.runtime)
    }
    if (current.version !== input.expectedVersion) {
      throw new StaleVersionError(input.expectedVersion, current.version)
    }
    if (current.status === "completed" || current.status === "failed") {
      throw new ConflictError(`terminal run ${input.runId}`)
    }
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
          eq(runs.id, input.runId),
          eq(runs.runtime, input.runtime),
          eq(runs.version, input.expectedVersion),
          or(isNull(runs.leaseOwner), lt(runs.leaseExpiresAt, new Date())),
        ),
      )
      .returning({
        owner: runs.leaseOwner,
        fencingVersion: runs.fencingVersion,
        version: runs.version,
        expiresAt: runs.leaseExpiresAt,
      })
    const lease = claimed[0]
    if (!lease?.owner || !lease.expiresAt) {
      throw new StaleLeaseError(input.expectedVersion, current.version)
    }
    return {
      owner: lease.owner,
      fencingVersion: lease.fencingVersion,
      version: lease.version,
      expiresAt: lease.expiresAt,
    }
  })

export const updateRunWithLease = async (
  database: DatabaseClient,
  input: LeaseMutationInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const selected = await transaction
      .select({
        version: runs.version,
        owner: runs.leaseOwner,
        fencingVersion: runs.fencingVersion,
        expiresAt: runs.leaseExpiresAt,
      })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1)
    const current = selected[0]
    if (!current || current.version !== input.expectedVersion) {
      throw new StaleVersionError(input.expectedVersion, current?.version ?? -1)
    }
    if (
      current.owner !== input.owner ||
      current.fencingVersion !== input.fencingVersion ||
      !current.expiresAt ||
      current.expiresAt <= new Date()
    ) {
      throw new StaleLeaseError(input.fencingVersion, current.fencingVersion)
    }
    const updated = await transaction
      .update(runs)
      .set({ status: input.status, version: sql`${runs.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.version, input.expectedVersion),
          eq(runs.leaseOwner, input.owner),
          eq(runs.fencingVersion, input.fencingVersion),
          sql`${runs.leaseExpiresAt} > now()`,
        ),
      )
      .returning({ version: runs.version })
    const result = updated[0]
    if (!result) {
      throw new StaleLeaseError(input.fencingVersion, current.fencingVersion)
    }
    return result
  })

export const persistLeasedRunTransition = async (
  database: DatabaseClient,
  input: LeasedRunTransitionInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const selected = await transaction
      .select({
        runtime: runs.runtime,
        version: runs.version,
        owner: runs.leaseOwner,
        fencingVersion: runs.fencingVersion,
        expiresAt: runs.leaseExpiresAt,
      })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .limit(1)
    const current = selected[0]
    if (current?.runtime !== input.runtime) {
      throw new ImmutableRuntimeAssignmentError(current?.runtime ?? "missing", input.runtime)
    }
    if (current.version !== input.expectedVersion) {
      throw new StaleVersionError(input.expectedVersion, current.version)
    }
    if (
      current.owner !== input.owner ||
      current.fencingVersion !== input.fencingVersion ||
      !current.expiresAt ||
      current.expiresAt <= new Date()
    ) {
      throw new StaleLeaseError(input.fencingVersion, current.fencingVersion)
    }
    const updated = await transaction
      .update(runs)
      .set({ status: input.status, version: sql`${runs.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(runs.id, input.runId),
          eq(runs.runtime, input.runtime),
          eq(runs.version, input.expectedVersion),
          eq(runs.leaseOwner, input.owner),
          eq(runs.fencingVersion, input.fencingVersion),
          sql`${runs.leaseExpiresAt} > now()`,
        ),
      )
      .returning({ version: runs.version })
    const result = updated[0]
    if (!result) throw new StaleLeaseError(input.fencingVersion, current.fencingVersion)
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
    return result
  })
