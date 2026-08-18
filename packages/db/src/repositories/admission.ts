import { type CanonicalEvent, ConflictError, type MessageId } from "@agentic-chat/contracts"
import { and, eq, max, sql } from "drizzle-orm"
import { z } from "zod"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import {
  conversations,
  dispatchIntents,
  idempotencyKeys,
  messages,
  runEvents,
  runs,
} from "../schema/index.js"

export type AdmissionReceiptRecord = {
  readonly commandId: string
  readonly status: "accepted"
  readonly runId: string
}

type AdmissionBase = {
  readonly key: string
  readonly requestHash: string
  readonly receipt: AdmissionReceiptRecord
  readonly messageId: MessageId
  readonly eventId: string
  readonly dispatchId: string
  readonly occurredAt: Date
}

export type NewRunAdmissionInput = AdmissionBase & {
  readonly conversationId: string
  readonly runtime: "simple_loop" | "state_workflow"
  readonly message: string
  readonly correlationId: string
}

export type ContinuationAdmissionInput = AdmissionBase & {
  readonly conversationId: string
  readonly correlationId: string
  readonly message: string
}

export type AdmissionResult = {
  readonly kind: "stored" | "replayed"
  readonly receipt: JsonValue
}

const continuationSchema = z
  .object({
    correlationId: z.string().min(1).optional(),
    wait: z
      .object({ kind: z.literal("user"), correlationId: z.string().min(1) })
      .passthrough()
      .optional(),
  })
  .passthrough()

const reserveInsideAdmission = async (
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  input: AdmissionBase,
): Promise<AdmissionResult | undefined> => {
  const response = input.receipt satisfies JsonValue
  const inserted = await transaction
    .insert(idempotencyKeys)
    .values({
      key: input.key,
      scope: "chat.send_message",
      requestHash: input.requestHash,
      response,
      createdAt: input.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key })
  if (inserted[0]) {
    return undefined
  }
  const existing = await transaction
    .select({
      scope: idempotencyKeys.scope,
      requestHash: idempotencyKeys.requestHash,
      response: idempotencyKeys.response,
    })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, input.key))
    .limit(1)
  const replay = existing[0]
  if (replay?.scope !== "chat.send_message" || replay.requestHash !== input.requestHash) {
    throw new ConflictError(`idempotency key ${input.key}`)
  }
  return { kind: "replayed", receipt: replay.response }
}

export const admitNewRun = async (
  database: DatabaseClient,
  input: NewRunAdmissionInput,
): Promise<AdmissionResult> =>
  database.db.transaction(async (transaction) => {
    const replay = await reserveInsideAdmission(transaction, input)
    if (replay) return replay
    const conversation = await transaction
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(and(eq(conversations.id, input.conversationId), eq(conversations.userId, "mvp_user")))
      .for("update")
      .limit(1)
    if (conversation[0]?.userId !== "mvp_user") {
      throw new ConflictError(`conversation ${input.conversationId}`)
    }
    await transaction
      .update(conversations)
      .set({ updatedAt: input.occurredAt })
      .where(eq(conversations.id, input.conversationId))
    const workflowIdentity =
      input.runtime === "state_workflow" ? `agent-run/${input.receipt.runId}` : null
    await transaction.insert(runs).values({
      id: input.receipt.runId,
      conversationId: input.conversationId,
      userId: "mvp_user",
      runtime: input.runtime,
      workflowIdentity,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    await transaction.insert(messages).values({
      id: input.messageId,
      conversationId: input.conversationId,
      runId: input.receipt.runId,
      actor: "user",
      content: input.message,
      createdAt: input.occurredAt,
    })
    const messagePayload = {
      messageId: input.messageId,
      actor: "user",
      content: input.message,
    } as const satisfies CanonicalEvent["payload"]
    await transaction.insert(runEvents).values({
      id: input.eventId,
      runId: input.receipt.runId,
      sequence: 1,
      type: "message.completed",
      visibility: "user",
      payload: messagePayload,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(dispatchIntents).values({
      id: input.dispatchId,
      aggregateType: "run",
      aggregateId: input.receipt.runId,
      deduplicationKey: `${input.receipt.runId}:admission`,
      topic: input.runtime === "simple_loop" ? "simple_loop.execute" : "state_workflow.start",
      payload: { runId: input.receipt.runId, runtime: input.runtime, workflowIdentity },
      createdAt: input.occurredAt,
      availableAt: input.occurredAt,
    })
    return { kind: "stored", receipt: input.receipt }
  })

export const admitContinuation = async (
  database: DatabaseClient,
  input: ContinuationAdmissionInput,
): Promise<AdmissionResult> =>
  database.db.transaction(async (transaction) => {
    const replay = await reserveInsideAdmission(transaction, input)
    if (replay) return replay
    const selected = await transaction
      .select({
        conversationId: runs.conversationId,
        runtime: runs.runtime,
        status: runs.status,
        continuation: runs.continuation,
      })
      .from(runs)
      .where(eq(runs.id, input.receipt.runId))
      .for("update")
      .limit(1)
    const current = selected[0]
    const continuation = continuationSchema.safeParse(current?.continuation)
    if (
      !current ||
      current.conversationId !== input.conversationId ||
      current.status !== "waiting_for_user" ||
      !continuation.success ||
      (continuation.data.correlationId ?? continuation.data.wait?.correlationId) !==
        input.correlationId
    ) {
      throw new ConflictError(`continuation ${input.receipt.runId}`)
    }
    const sequenceResult = await transaction
      .select({ sequence: max(runEvents.sequence) })
      .from(runEvents)
      .where(eq(runEvents.runId, input.receipt.runId))
    const sequence = (sequenceResult[0]?.sequence ?? 0) + 1
    await transaction
      .update(runs)
      .set({
        status: "running",
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.receipt.runId))
    await transaction
      .update(conversations)
      .set({ updatedAt: input.occurredAt })
      .where(eq(conversations.id, current.conversationId))
    await transaction.insert(messages).values({
      id: input.messageId,
      conversationId: input.conversationId,
      runId: input.receipt.runId,
      actor: "user",
      content: input.message,
      createdAt: input.occurredAt,
    })
    const messagePayload = {
      messageId: input.messageId,
      actor: "user",
      content: input.message,
    } as const satisfies CanonicalEvent["payload"]
    await transaction.insert(runEvents).values({
      id: input.eventId,
      runId: input.receipt.runId,
      sequence,
      type: "message.completed",
      visibility: "user",
      payload: messagePayload,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(dispatchIntents).values({
      id: input.dispatchId,
      aggregateType: "run",
      aggregateId: input.receipt.runId,
      deduplicationKey: `${input.receipt.runId}:continuation:${sequence}`,
      topic: current.runtime === "simple_loop" ? "simple_loop.execute" : "state_workflow.signal",
      payload:
        current.runtime === "simple_loop"
          ? {
              runId: input.receipt.runId,
              runtime: current.runtime,
              correlationId: input.correlationId,
            }
          : {
              kind: "user_continuation",
              runId: input.receipt.runId,
              correlationId: input.correlationId,
            },
      createdAt: input.occurredAt,
      availableAt: input.occurredAt,
    })
    return { kind: "stored", receipt: input.receipt }
  })
