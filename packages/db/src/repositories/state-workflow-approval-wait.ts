import { ApprovalIdSchema, CallIdSchema, parseContract } from "@agentic-chat/contracts"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { approvalRequests, runEvents, toolCalls } from "../schema/index.js"
import { canonicalNotificationArguments } from "./approval-bindings.js"
import { lockStateWorkflowRun, nextStateWorkflowSequence } from "./state-workflow-lock.js"
import {
  enterStateWorkflowWait,
  type StateWorkflowWaitTransition,
} from "./state-workflow-wait-base.js"

export type PersistStateWorkflowApprovalWaitInput = StateWorkflowWaitTransition & {
  readonly callId: string
  readonly approvalId: string
  readonly arguments: JsonValue
  readonly approvalEventId: string
  readonly expiresAt: Date
}

export const persistStateWorkflowApprovalWait = async (
  database: DatabaseClient,
  input: PersistStateWorkflowApprovalWaitInput,
): Promise<{ readonly version: number; readonly argumentsHash: string }> =>
  database.db.transaction(async (transaction) => {
    await lockStateWorkflowRun(transaction, input)
    const callId = parseContract(CallIdSchema, input.callId)
    const approvalId = parseContract(ApprovalIdSchema, input.approvalId)
    const canonical = canonicalNotificationArguments(input.arguments)
    await transaction.insert(toolCalls).values({
      id: callId,
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
      id: approvalId,
      runId: input.runId,
      callId,
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
      sequence: await nextStateWorkflowSequence(transaction, input.runId),
      type: "approval.requested",
      visibility: "admin",
      payload: {
        approvalId,
        callId,
        toolName: "notification.send_email",
        argumentsHash: canonical.hash,
        expiresAt: input.expiresAt.toISOString(),
      },
      correlationId: callId,
      occurredAt: input.occurredAt,
    })
    return {
      version: await enterStateWorkflowWait(transaction, input, "waiting_for_admin"),
      argumentsHash: canonical.hash,
    }
  })
