import {
  assertRunTransition,
  CallIdSchema,
  CanonicalEventSchema,
  parseContract,
  type RunState,
  ToolNameSchema,
} from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { runEvents, runs, toolCalls } from "../schema/index.js"
import {
  lockStateWorkflowRun,
  nextStateWorkflowSequence,
  type StateWorkflowEventIdentity,
  type StateWorkflowMutationIdentity,
  type StateWorkflowTransaction,
} from "./state-workflow-lock.js"

export type StateWorkflowWaitTransition = StateWorkflowMutationIdentity &
  StateWorkflowEventIdentity & {
    readonly statusEventId: string
    readonly context: JsonValue
  }

export const enterStateWorkflowWait = async (
  transaction: StateWorkflowTransaction,
  input: StateWorkflowWaitTransition,
  status: Extract<RunState, "waiting_for_tool" | "waiting_for_admin" | "waiting_for_user">,
): Promise<number> => {
  const current = await lockStateWorkflowRun(transaction, input)
  const nextStatus = assertRunTransition(current.status, status)
  const statusEvent = parseContract(CanonicalEventSchema, {
    eventId: input.statusEventId,
    runId: input.runId,
    sequence: await nextStateWorkflowSequence(transaction, input.runId),
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

export const persistStateWorkflowUserWait = async (
  database: DatabaseClient,
  input: StateWorkflowWaitTransition,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => ({
    version: await enterStateWorkflowWait(transaction, input, "waiting_for_user"),
  }))

export const resolveStateWorkflowWait = async (
  database: DatabaseClient,
  input: StateWorkflowWaitTransition & {
    readonly callId?: string
    readonly callStatus?: "completed" | "rejected"
    readonly toolName?: "report.generate" | "notification.send_email"
    readonly result?: JsonValue
  },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockStateWorkflowRun(transaction, input)
    if (input.callId && input.callStatus && input.toolName && input.result !== undefined) {
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
      const sequence = await nextStateWorkflowSequence(transaction, input.runId)
      const event = parseContract(CanonicalEventSchema, {
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
        id: event.eventId,
        runId: event.runId,
        sequence: event.sequence,
        type: event.type,
        visibility: event.visibility,
        payload: event.payload,
        correlationId: event.correlationId,
        occurredAt: input.occurredAt,
      })
    }
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
    if (current.status !== "running") {
      await transaction.insert(runEvents).values({
        id: input.statusEventId,
        runId: input.runId,
        sequence: await nextStateWorkflowSequence(transaction, input.runId),
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: current.status, current: "running" },
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      })
    }
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })
