import {
  CanonicalEventSchema,
  ConflictError,
  InvalidAdminCommandError,
  parseContract,
} from "@agentic-chat/contracts"
import { and, eq, max, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { adminCommands, runEvents, runs } from "../schema/index.js"

export type StoredAdminCommand = typeof adminCommands.$inferSelect

const adminCommandVisibility = {
  accepted: "model_only",
  applied: "model_only",
  expired: "admin",
} as const

type SubmitAdminCommandInput = {
  readonly commandId: string
  readonly runId: string
  readonly instruction: string
  readonly expiresAt: Date
  readonly idempotencyKey: string
  readonly now: Date
  readonly eventId: string
  readonly correlationId: string
}

type ApplyAdminCommandInput = {
  readonly commandId: string
  readonly runId: string
  readonly boundary: "before_model"
  readonly now: Date
  readonly eventId: string
  readonly correlationId: string
}

const nextSequence = async (
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  runId: string,
): Promise<number> => {
  const rows = await transaction
    .select({ sequence: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
  return (rows[0]?.sequence ?? 0) + 1
}

const appendStatusEvent = async (
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  input: {
    readonly commandId: string
    readonly runId: string
    readonly status: "accepted" | "applied" | "expired"
    readonly eventId: string
    readonly correlationId: string
    readonly occurredAt: Date
  },
): Promise<void> => {
  const sequence = await nextSequence(transaction, input.runId)
  const event = parseContract(CanonicalEventSchema, {
    eventId: input.eventId,
    runId: input.runId,
    sequence,
    type: `admin.command.${input.status}`,
    visibility: adminCommandVisibility[input.status],
    payload: { commandId: input.commandId, status: input.status },
    correlationId: input.correlationId,
    occurredAt: input.occurredAt.toISOString(),
  })
  await transaction.insert(runEvents).values({
    id: input.eventId,
    runId: input.runId,
    sequence,
    type: event.type,
    visibility: event.visibility,
    payload: event.payload,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  })
}

export const submitAdminCommand = async (
  database: DatabaseClient,
  input: SubmitAdminCommandInput,
): Promise<StoredAdminCommand> =>
  database.db.transaction(async (transaction) => {
    const runRows = await transaction
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .for("update")
      .limit(1)
    const run = runRows[0]
    if (
      !run ||
      run.status === "completed" ||
      run.status === "failed" ||
      input.expiresAt <= input.now
    ) {
      throw new InvalidAdminCommandError("target run is unavailable")
    }
    const insertedRows = await transaction
      .insert(adminCommands)
      .values({
        id: input.commandId,
        runId: input.runId,
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
    const inserted = insertedRows[0]
    if (!inserted) {
      const existingRows = await transaction
        .select()
        .from(adminCommands)
        .where(eq(adminCommands.idempotencyKey, input.idempotencyKey))
        .limit(1)
      const existing = existingRows[0]
      if (
        !existing ||
        existing.runId !== input.runId ||
        existing.instruction !== input.instruction ||
        existing.expiresAt.getTime() !== input.expiresAt.getTime()
      ) {
        throw new ConflictError(`Admin command idempotency key ${input.idempotencyKey}`)
      }
      return existing
    }
    await appendStatusEvent(transaction, {
      commandId: inserted.id,
      runId: inserted.runId,
      status: "accepted",
      eventId: input.eventId,
      correlationId: input.correlationId,
      occurredAt: input.now,
    })
    return inserted
  })

const applyInsideTransaction = async (
  database: DatabaseClient,
  input: ApplyAdminCommandInput,
): Promise<
  { readonly kind: "applied"; readonly command: StoredAdminCommand } | { readonly kind: "expired" }
> =>
  database.db.transaction(async (transaction) => {
    const runRows = await transaction
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .for("update")
      .limit(1)
    const commandRows = await transaction
      .select()
      .from(adminCommands)
      .where(and(eq(adminCommands.id, input.commandId), eq(adminCommands.runId, input.runId)))
      .for("update")
      .limit(1)
    const run = runRows[0]
    const command = commandRows[0]
    if (run?.status !== "running" || !command || command.status !== "accepted") {
      throw new InvalidAdminCommandError("command is not applicable at this boundary")
    }
    if (command.expiresAt <= input.now) {
      await transaction
        .update(adminCommands)
        .set({ status: "expired", version: sql`${adminCommands.version} + 1` })
        .where(eq(adminCommands.id, command.id))
      await appendStatusEvent(transaction, {
        commandId: command.id,
        runId: command.runId,
        status: "expired",
        eventId: input.eventId,
        correlationId: input.correlationId,
        occurredAt: input.now,
      })
      return { kind: "expired" }
    }
    const updatedRows = await transaction
      .update(adminCommands)
      .set({ status: "applied", appliedAt: input.now, version: sql`${adminCommands.version} + 1` })
      .where(and(eq(adminCommands.id, command.id), eq(adminCommands.version, command.version)))
      .returning()
    const updated = updatedRows[0]
    if (!updated) throw new InvalidAdminCommandError("command was already consumed")
    await appendStatusEvent(transaction, {
      commandId: command.id,
      runId: command.runId,
      status: "applied",
      eventId: input.eventId,
      correlationId: input.correlationId,
      occurredAt: input.now,
    })
    return { kind: "applied", command: updated }
  })

export const applyAdminCommand = async (
  database: DatabaseClient,
  input: ApplyAdminCommandInput,
): Promise<StoredAdminCommand> => {
  const result = await applyInsideTransaction(database, input)
  if (result.kind === "expired") throw new InvalidAdminCommandError("command expired")
  return result.command
}

export const readPendingAdminCommand = async (
  database: DatabaseClient,
  runId: string,
): Promise<StoredAdminCommand | null> => {
  const rows = await database.db
    .select()
    .from(adminCommands)
    .where(and(eq(adminCommands.runId, runId), eq(adminCommands.status, "accepted")))
    .orderBy(adminCommands.createdAt, adminCommands.id)
    .limit(1)
  return rows[0] ?? null
}

export const readAdminCommand = async (
  database: DatabaseClient,
  input: { readonly runId: string; readonly commandId: string },
): Promise<StoredAdminCommand | null> => {
  const rows = await database.db
    .select()
    .from(adminCommands)
    .where(and(eq(adminCommands.runId, input.runId), eq(adminCommands.id, input.commandId)))
    .limit(1)
  return rows[0] ?? null
}
