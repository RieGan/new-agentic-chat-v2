import {
  CanonicalEventSchema,
  ConflictError,
  InvalidAdminCommandError,
  parseContract,
} from "@agentic-chat/contracts"
import { and, asc, eq, lte, max, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { adminCommands, conversations, runEvents, runs } from "../schema/index.js"

export type StoredAdminCommand = typeof adminCommands.$inferSelect
type Transaction = Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0]

type SubmitAdminCommandInput = {
  readonly commandId: string
  readonly conversationId: string
  readonly instruction: string
  readonly expiresAt: Date
  readonly idempotencyKey: string
  readonly now: Date
}

type ClaimAdminCommandInput = {
  readonly runId: string
  readonly boundaryKey: string
  readonly now: Date
  readonly eventId: string
  readonly correlationId: string
}

const appendAppliedEvent = async (
  transaction: Transaction,
  input: ClaimAdminCommandInput & { readonly commandId: string },
): Promise<void> => {
  const sequenceRows = await transaction
    .select({ sequence: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.runId, input.runId))
  const sequence = (sequenceRows[0]?.sequence ?? 0) + 1
  const event = parseContract(CanonicalEventSchema, {
    eventId: input.eventId,
    runId: input.runId,
    sequence,
    type: "admin.command.applied",
    visibility: "model_only",
    payload: { commandId: input.commandId, status: "applied" },
    correlationId: input.correlationId,
    occurredAt: input.now.toISOString(),
  })
  await transaction.insert(runEvents).values({
    id: input.eventId,
    runId: input.runId,
    sequence,
    type: event.type,
    visibility: event.visibility,
    payload: event.payload,
    correlationId: input.correlationId,
    occurredAt: input.now,
  })
}

export const submitAdminCommand = async (
  database: DatabaseClient,
  input: SubmitAdminCommandInput,
): Promise<StoredAdminCommand> =>
  database.db.transaction(async (transaction) => {
    const owner = await transaction
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, "mvp_user")))
      .for("update")
      .limit(1)
    if (!owner[0] || input.expiresAt <= input.now) {
      throw new InvalidAdminCommandError("target conversation is unavailable")
    }
    const inserted = await transaction
      .insert(adminCommands)
      .values({
        id: input.commandId,
        conversationId: input.conversationId,
        actorId: "mvp_admin",
        instruction: input.instruction,
        visibility: "model_only",
        status: "accepted",
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      })
      .onConflictDoNothing({ target: adminCommands.idempotencyKey })
      .returning()
    if (inserted[0]) return inserted[0]

    const existing = await transaction
      .select()
      .from(adminCommands)
      .where(eq(adminCommands.idempotencyKey, input.idempotencyKey))
      .limit(1)
    const replay = existing[0]
    if (
      !replay ||
      replay.conversationId !== input.conversationId ||
      replay.instruction !== input.instruction ||
      replay.expiresAt.getTime() !== input.expiresAt.getTime()
    ) {
      throw new ConflictError(`Admin command idempotency key ${input.idempotencyKey}`)
    }
    return replay
  })

export const claimAdminCommandAtBoundary = async (
  database: DatabaseClient,
  input: ClaimAdminCommandInput,
): Promise<StoredAdminCommand | null> =>
  database.db.transaction(async (transaction) => {
    const runRows = await transaction
      .select({ conversationId: runs.conversationId, status: runs.status })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .for("update")
      .limit(1)
    const run = runRows[0]
    if (run === undefined || (run.status !== "queued" && run.status !== "running")) {
      throw new InvalidAdminCommandError("run boundary is unavailable")
    }
    await transaction
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, run.conversationId))
      .for("update")

    const replayRows = await transaction
      .select()
      .from(adminCommands)
      .where(
        and(
          eq(adminCommands.conversationId, run.conversationId),
          eq(adminCommands.boundaryKey, input.boundaryKey),
        ),
      )
      .limit(1)
    const replay = replayRows[0]
    if (replay) {
      if (replay.appliedRunId !== input.runId) {
        throw new InvalidAdminCommandError("boundary key belongs to another run")
      }
      return replay
    }

    await transaction
      .update(adminCommands)
      .set({ status: "expired", version: sql`${adminCommands.version} + 1` })
      .where(
        and(
          eq(adminCommands.conversationId, run.conversationId),
          eq(adminCommands.status, "accepted"),
          lte(adminCommands.expiresAt, input.now),
        ),
      )

    const pendingRows = await transaction
      .select()
      .from(adminCommands)
      .where(
        and(
          eq(adminCommands.conversationId, run.conversationId),
          eq(adminCommands.status, "accepted"),
        ),
      )
      .orderBy(asc(adminCommands.createdAt), asc(adminCommands.id))
      .for("update")
      .limit(1)
    const pending = pendingRows[0]
    if (!pending) return null

    const appliedRows = await transaction
      .update(adminCommands)
      .set({
        status: "applied",
        appliedRunId: input.runId,
        boundaryKey: input.boundaryKey,
        appliedAt: input.now,
        version: sql`${adminCommands.version} + 1`,
      })
      .where(and(eq(adminCommands.id, pending.id), eq(adminCommands.status, "accepted")))
      .returning()
    const applied = appliedRows[0]
    if (!applied) throw new InvalidAdminCommandError("command was already consumed")
    await appendAppliedEvent(transaction, { ...input, commandId: applied.id })
    return applied
  })

export const readPendingAdminCommand = async (
  database: DatabaseClient,
  conversationId: string,
): Promise<StoredAdminCommand | null> => {
  const rows = await database.db
    .select()
    .from(adminCommands)
    .where(
      and(eq(adminCommands.conversationId, conversationId), eq(adminCommands.status, "accepted")),
    )
    .orderBy(asc(adminCommands.createdAt), asc(adminCommands.id))
    .limit(1)
  return rows[0] ?? null
}

export const readAdminCommand = async (
  database: DatabaseClient,
  input: { readonly conversationId: string; readonly commandId: string },
): Promise<StoredAdminCommand | null> => {
  const rows = await database.db
    .select()
    .from(adminCommands)
    .where(
      and(
        eq(adminCommands.conversationId, input.conversationId),
        eq(adminCommands.id, input.commandId),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}
