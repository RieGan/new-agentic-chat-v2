import {
  ApprovalIdSchema,
  CallIdSchema,
  CanonicalEventSchema,
  parseContract,
  ToolNameSchema,
} from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { approvalRequests, runEvents, runs, toolCalls } from "../schema/index.js"
import { canonicalNotificationArguments } from "./approval-bindings.js"
import { lockSimpleLoopLease, nextSimpleLoopSequence } from "./simple-loop-lock.js"
import { releaseForSimpleLoopWait, type WaitTransition } from "./simple-loop-wait-base.js"

export type PersistApprovalWaitInput = WaitTransition & {
  readonly callId: string
  readonly approvalId: string
  readonly arguments: JsonValue
  readonly approvalEventId: string
  readonly expiresAt: Date
}

export const persistSimpleLoopApprovalWait = async (
  database: DatabaseClient,
  input: PersistApprovalWaitInput,
): Promise<{ readonly version: number; readonly argumentsHash: string }> =>
  database.db.transaction(async (transaction) => {
    await lockSimpleLoopLease(transaction, input)
    const callId = parseContract(CallIdSchema, input.callId)
    const approvalId = parseContract(ApprovalIdSchema, input.approvalId)
    const canonical = canonicalNotificationArguments(input.arguments)
    await transaction.insert(toolCalls).values({
      id: input.callId,
      runId: input.runId,
      toolId: "notification.send_email",
      toolVersion: "1",
      status: "approval_required",
      arguments: canonical.arguments,
      argumentsHash: canonical.hash,
      version: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    await transaction.insert(approvalRequests).values({
      id: input.approvalId,
      runId: input.runId,
      callId: input.callId,
      toolId: "notification.send_email",
      toolVersion: "1",
      arguments: canonical.arguments,
      argumentsHash: canonical.hash,
      requiredActorId: "mvp_admin",
      expiresAt: input.expiresAt,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.approvalEventId,
      runId: input.runId,
      sequence: await nextSimpleLoopSequence(transaction, input.runId),
      type: "approval.requested",
      visibility: "admin",
      payload: {
        approvalId,
        callId,
        toolName: "notification.send_email",
        argumentsHash: canonical.hash,
        expiresAt: input.expiresAt.toISOString(),
      },
      correlationId: input.callId,
      occurredAt: input.occurredAt,
    })
    return {
      version: await releaseForSimpleLoopWait(transaction, input, "waiting_for_admin"),
      argumentsHash: canonical.hash,
    }
  })

export type ResolveWaitInput = WaitTransition & {
  readonly callId: string
  readonly toolName: "report.generate" | "notification.send_email"
  readonly result: JsonValue
  readonly callStatus: "completed" | "rejected"
}

export const resolveSimpleLoopWait = async (
  database: DatabaseClient,
  input: ResolveWaitInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockSimpleLoopLease(transaction, input)
    const callId = parseContract(CallIdSchema, input.callId)
    const toolName = parseContract(ToolNameSchema, input.toolName)
    await transaction
      .update(toolCalls)
      .set({
        status: input.callStatus,
        result: input.result,
        version: sql`${toolCalls.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(and(eq(toolCalls.id, input.callId), eq(toolCalls.runId, input.runId)))
    const updated = await transaction
      .update(runs)
      .set({
        status: "running",
        continuation: input.context,
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(and(eq(runs.id, input.runId), eq(runs.version, input.expectedVersion)))
      .returning({ version: runs.version })
    const sequence = await nextSimpleLoopSequence(transaction, input.runId)
    const toolEvent = parseContract(CanonicalEventSchema, {
      eventId: input.eventId,
      runId: input.runId,
      sequence,
      type: input.callStatus === "completed" ? "tool.call.completed" : "tool.call.rejected",
      visibility: "user",
      payload:
        input.callStatus === "completed"
          ? { callId, toolName, result: input.result }
          : { callId, toolName, reason: "not sent" },
      correlationId: input.correlationId,
      occurredAt: input.occurredAt.toISOString(),
    })
    await transaction.insert(runEvents).values({
      id: toolEvent.eventId,
      runId: input.runId,
      sequence,
      type: toolEvent.type,
      visibility: toolEvent.visibility,
      payload: toolEvent.payload,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.statusEventId,
      runId: input.runId,
      sequence: sequence + 1,
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: current.status, current: "running" },
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })
