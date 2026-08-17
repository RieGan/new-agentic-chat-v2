import {
  assertRunTransition,
  CanonicalEventSchema,
  parseContract,
  type RunState,
} from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { runEvents, runs } from "../schema/index.js"
import {
  type LeaseIdentity,
  lockSimpleLoopLease,
  nextSimpleLoopSequence,
  type SimpleLoopEventIdentity,
} from "./simple-loop-lock.js"

export type WaitTransition = LeaseIdentity &
  SimpleLoopEventIdentity & {
    readonly statusEventId: string
    readonly context: JsonValue
  }

export const releaseForSimpleLoopWait = async (
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  input: WaitTransition,
  status: Extract<RunState, "waiting_for_tool" | "waiting_for_admin" | "waiting_for_user">,
): Promise<number> => {
  const current = await lockSimpleLoopLease(transaction, input)
  const nextStatus = assertRunTransition(current.status, status)
  const statusEvent = parseContract(CanonicalEventSchema, {
    eventId: input.statusEventId,
    runId: input.runId,
    sequence: await nextSimpleLoopSequence(transaction, input.runId),
    type: "run.status_changed",
    visibility: "user",
    payload: { previous: current.status, current: nextStatus },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt.toISOString(),
  })
  const updated = await transaction
    .update(runs)
    .set({
      status: nextStatus,
      continuation: input.context,
      leaseOwner: null,
      leaseExpiresAt: null,
      version: sql`${runs.version} + 1`,
      updatedAt: input.occurredAt,
    })
    .where(and(eq(runs.id, input.runId), eq(runs.version, input.expectedVersion)))
    .returning({ version: runs.version })
  await transaction.insert(runEvents).values({
    id: statusEvent.eventId,
    runId: statusEvent.runId,
    sequence: statusEvent.sequence,
    type: statusEvent.type,
    visibility: statusEvent.visibility,
    payload: statusEvent.payload,
    correlationId: statusEvent.correlationId,
    occurredAt: input.occurredAt,
  })
  return updated[0]?.version ?? input.expectedVersion + 1
}

export const persistSimpleLoopUserWait = async (
  database: DatabaseClient,
  input: WaitTransition,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => ({
    version: await releaseForSimpleLoopWait(transaction, input, "waiting_for_user"),
  }))
