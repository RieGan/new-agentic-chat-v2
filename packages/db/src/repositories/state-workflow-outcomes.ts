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
  lockStateWorkflowRun,
  nextStateWorkflowSequence,
  type StateWorkflowEventIdentity,
  type StateWorkflowMutationIdentity,
} from "./state-workflow-lock.js"

type StateWorkflowToolOutcome =
  | { readonly status: "completed"; readonly result: ToolResult }
  | { readonly status: "failed" | "rejected"; readonly error: ContractErrorData }

export const persistStateWorkflowToolOutcome = async (
  database: DatabaseClient,
  input: StateWorkflowMutationIdentity &
    StateWorkflowEventIdentity & {
      readonly terminalEventId: string
      readonly callId: CallId
      readonly toolName: ToolName
      readonly arguments: JsonValue
      readonly argumentsHash: string
      readonly context: JsonValue
      readonly outcome: StateWorkflowToolOutcome
    },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockStateWorkflowRun(transaction, input)
    const existing = await transaction
      .select({ id: toolCalls.id })
      .from(toolCalls)
      .where(eq(toolCalls.id, input.callId))
      .limit(1)
    if (existing[0] !== undefined) return { version: input.expectedVersion }
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
    const sequence = await nextStateWorkflowSequence(transaction, input.runId)
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

export const completeStateWorkflowRun = async (
  database: DatabaseClient,
  input: StateWorkflowMutationIdentity & {
    readonly messageEvent: StateWorkflowEventIdentity
    readonly statusEvent: StateWorkflowEventIdentity
    readonly messageId: MessageId
    readonly text: string
    readonly status: Extract<RunState, "completed" | "failed">
    readonly context: JsonValue
  },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockStateWorkflowRun(transaction, input)
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
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.runId))
      .returning({ version: runs.version })
    const sequence = await nextStateWorkflowSequence(transaction, input.runId)
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
