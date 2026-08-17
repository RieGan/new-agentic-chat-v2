import type {
  CallId,
  ContractErrorData,
  MessageId,
  RunState,
  ToolName,
  ToolResult,
} from "@agentic-chat/contracts"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { messages, runEvents, runs, toolCalls } from "../schema/index.js"
import {
  type LeaseIdentity,
  lockSimpleLoopLease,
  nextSimpleLoopSequence,
  type SimpleLoopEventIdentity,
} from "./simple-loop-lock.js"

type ToolOutcome =
  | { readonly status: "completed"; readonly result: ToolResult }
  | { readonly status: "failed"; readonly error: ContractErrorData }
  | { readonly status: "rejected"; readonly error: ContractErrorData }

export const persistSimpleLoopToolOutcome = async (
  database: DatabaseClient,
  input: LeaseIdentity &
    SimpleLoopEventIdentity & {
      readonly terminalEventId: string
      readonly callId: CallId
      readonly toolName: ToolName
      readonly arguments: JsonValue
      readonly argumentsHash: string
      readonly context: JsonValue
      readonly outcome: ToolOutcome
    },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockSimpleLoopLease(transaction, input)
    await transaction.insert(toolCalls).values({
      id: input.callId,
      runId: input.runId,
      toolId: input.toolName,
      toolVersion: "1",
      status: input.outcome.status,
      arguments: input.arguments,
      argumentsHash: input.argumentsHash,
      result: input.outcome.status === "completed" ? z.json().parse(input.outcome.result) : null,
      error: input.outcome.status === "completed" ? null : input.outcome.error,
      version: 1,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    const updated = await transaction
      .update(runs)
      .set({
        continuation: input.context,
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.runId))
      .returning({ version: runs.version })
    const sequence = await nextSimpleLoopSequence(transaction, input.runId)
    await transaction.insert(runEvents).values({
      id: input.eventId,
      runId: input.runId,
      sequence,
      type: "tool.call.started",
      visibility: "user",
      payload: { callId: input.callId, toolName: input.toolName },
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.terminalEventId,
      runId: input.runId,
      sequence: sequence + 1,
      type:
        input.outcome.status === "completed"
          ? "tool.call.completed"
          : input.outcome.status === "failed"
            ? "tool.call.failed"
            : "tool.call.rejected",
      visibility: "user",
      payload:
        input.outcome.status === "completed"
          ? { callId: input.callId, toolName: input.toolName, result: input.outcome.result }
          : input.outcome.status === "failed"
            ? { callId: input.callId, toolName: input.toolName, error: input.outcome.error }
            : {
                callId: input.callId,
                toolName: input.toolName,
                reason: input.outcome.error.message,
              },
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })

export const completeSimpleLoopRun = async (
  database: DatabaseClient,
  input: LeaseIdentity & {
    readonly messageEvent: SimpleLoopEventIdentity
    readonly statusEvent: SimpleLoopEventIdentity
    readonly messageId: MessageId
    readonly text: string
    readonly status: Extract<RunState, "completed" | "failed">
    readonly context: JsonValue
  },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockSimpleLoopLease(transaction, input)
    await transaction.insert(messages).values({
      id: input.messageId,
      conversationId: current.conversationId,
      runId: input.runId,
      actor: "ai",
      content: input.text,
      createdAt: input.occurredAt,
    })
    const updated = await transaction
      .update(runs)
      .set({
        status: input.status,
        continuation: input.context,
        leaseOwner: null,
        leaseExpiresAt: null,
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.runId))
      .returning({ version: runs.version })
    const sequence = await nextSimpleLoopSequence(transaction, input.runId)
    await transaction.insert(runEvents).values({
      id: input.messageEvent.eventId,
      runId: input.runId,
      sequence,
      type: "message.completed",
      visibility: "user",
      payload: { messageId: input.messageId, actor: "ai", content: input.text },
      correlationId: input.messageEvent.correlationId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.statusEvent.eventId,
      runId: input.runId,
      sequence: sequence + 1,
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: "running", current: input.status },
      correlationId: input.statusEvent.correlationId,
      occurredAt: input.occurredAt,
    })
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })
