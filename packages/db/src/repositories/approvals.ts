import {
  InvalidApprovalError,
  NotificationSendArgumentsSchema,
  parseContract,
} from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { approvalRequests, runs, toolCalls } from "../schema/index.js"
import { canonicalNotificationArguments } from "./approval-bindings.js"

export type ApprovalSnapshotRecord = {
  readonly approvalId: string
  readonly runId: string
  readonly callId: string
  readonly toolVersion: string
  readonly arguments: ReturnType<typeof NotificationSendArgumentsSchema.parse>
  readonly argumentsHash: string
  readonly status: "pending" | "approved" | "rejected" | "expired"
  readonly version: number
  readonly expiresAt: Date
  readonly decidedAt?: Date
  readonly reason?: string
  readonly expiredAt?: Date
}

type PrepareApprovalInput = {
  readonly approvalId: string
  readonly runId: string
  readonly callId: string
  readonly expiresAt: Date
  readonly now: Date
}

type ApprovalIdentity = {
  readonly approvalId: string
  readonly callId: string
  readonly actionId: string
  readonly actorId: "mvp_admin"
  readonly expectedArgumentsHash: string
  readonly expectedVersion: number
  readonly decidedAt?: Date
}

export type ApprovalDecisionInput = ApprovalIdentity &
  ({ readonly decision: "approved" } | { readonly decision: "rejected"; readonly reason: string })

export const toApprovalSnapshot = (
  approval: typeof approvalRequests.$inferSelect,
  details: { readonly decidedAt?: Date; readonly reason?: string; readonly expiredAt?: Date } = {},
): ApprovalSnapshotRecord => ({
  approvalId: approval.id,
  runId: approval.runId,
  callId: approval.callId,
  toolVersion: approval.toolVersion,
  arguments: parseContract(NotificationSendArgumentsSchema, approval.arguments),
  argumentsHash: approval.argumentsHash,
  status: approval.status,
  version: approval.version,
  expiresAt: approval.expiresAt,
  ...details,
})

export const prepareApproval = async (
  database: DatabaseClient,
  input: PrepareApprovalInput,
): Promise<ApprovalSnapshotRecord> =>
  database.db.transaction(async (transaction) => {
    const runRows = await transaction
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, input.runId))
      .for("update")
      .limit(1)
    const callRows = await transaction
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, input.callId))
      .for("update")
      .limit(1)
    const run = runRows[0]
    const call = callRows[0]
    if (
      !run ||
      run.status === "completed" ||
      run.status === "failed" ||
      !call ||
      call.runId !== input.runId ||
      call.toolId !== "notification.send_email" ||
      call.status !== "prepared" ||
      input.expiresAt <= input.now
    ) {
      throw new InvalidApprovalError("prepared call binding mismatch")
    }
    const canonical = canonicalNotificationArguments(call.arguments)
    if (canonical.hash !== call.argumentsHash) {
      throw new InvalidApprovalError("prepared arguments hash mismatch")
    }
    const insertedRows = await transaction
      .insert(approvalRequests)
      .values({
        id: input.approvalId,
        runId: input.runId,
        callId: input.callId,
        toolId: call.toolId,
        toolVersion: call.toolVersion,
        arguments: canonical.arguments,
        argumentsHash: canonical.hash,
        requiredActorId: "mvp_admin",
        expiresAt: input.expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
    await transaction
      .update(toolCalls)
      .set({
        status: "approval_required",
        version: sql`${toolCalls.version} + 1`,
        updatedAt: input.now,
      })
      .where(eq(toolCalls.id, input.callId))
    const approval = insertedRows[0]
    if (!approval) throw new InvalidApprovalError("approval snapshot was not stored")
    return toApprovalSnapshot(approval)
  })

export const readApprovalSnapshot = async (
  database: DatabaseClient,
  input: { readonly runId: string; readonly approvalId: string; readonly callId: string },
): Promise<ApprovalSnapshotRecord | null> => {
  const rows = await database.db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, input.approvalId),
        eq(approvalRequests.runId, input.runId),
        eq(approvalRequests.callId, input.callId),
      ),
    )
    .limit(1)
  return rows[0] ? toApprovalSnapshot(rows[0]) : null
}
