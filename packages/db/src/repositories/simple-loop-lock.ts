import { StaleLeaseError, StaleVersionError } from "@agentic-chat/contracts"
import { eq, max } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { runEvents, runs } from "../schema/index.js"

export type LeaseIdentity = {
  readonly runId: string
  readonly owner: string
  readonly fencingVersion: number
  readonly expectedVersion: number
  readonly occurredAt: Date
}

export type SimpleLoopEventIdentity = {
  readonly eventId: string
  readonly correlationId: string
}

type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0]

export const lockSimpleLoopLease = async (transaction: Transaction, input: LeaseIdentity) => {
  const selected = await transaction
    .select({
      version: runs.version,
      runtime: runs.runtime,
      status: runs.status,
      owner: runs.leaseOwner,
      fencingVersion: runs.fencingVersion,
      expiresAt: runs.leaseExpiresAt,
      consumedSteps: runs.consumedSteps,
      conversationId: runs.conversationId,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .for("update")
    .limit(1)
  const current = selected[0]
  if (!current || current.version !== input.expectedVersion) {
    throw new StaleVersionError(input.expectedVersion, current?.version ?? -1)
  }
  if (
    current.runtime !== "simple_loop" ||
    current.owner !== input.owner ||
    current.fencingVersion !== input.fencingVersion ||
    !current.expiresAt ||
    current.expiresAt <= input.occurredAt
  ) {
    throw new StaleLeaseError(input.fencingVersion, current.fencingVersion)
  }
  return current
}

export const nextSimpleLoopSequence = async (
  transaction: Transaction,
  runId: string,
): Promise<number> => {
  const selected = await transaction
    .select({ sequence: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
  return (selected[0]?.sequence ?? 0) + 1
}
