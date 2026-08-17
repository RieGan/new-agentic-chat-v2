import { DuplicateError, InvalidApprovalError } from "@agentic-chat/contracts"
import { and, eq } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { approvalRequests, runs, simulatedSends, toolCalls } from "../schema/index.js"
import { assertExactApprovalBinding } from "./approval-bindings.js"

export type SimulatedSendInput = {
  readonly callId: string
  readonly messageId: string
}

export type SimulatedSend = SimulatedSendInput & {
  readonly sentAt: Date
}

export const recordSimulatedSend = async (
  database: DatabaseClient,
  input: SimulatedSendInput,
): Promise<SimulatedSend> =>
  database.db.transaction(async (transaction) => {
    const approvals = await transaction
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.callId, input.callId))
      .for("update")
      .limit(1)
    if (approvals[0]?.status !== "approved") {
      throw new InvalidApprovalError(`call ${input.callId} is not approved`)
    }
    const inserted = await transaction
      .insert(simulatedSends)
      .values(input)
      .onConflictDoNothing()
      .returning()
    const stored = inserted[0]
    if (stored) {
      return stored
    }
    const existing = await transaction
      .select()
      .from(simulatedSends)
      .where(eq(simulatedSends.callId, input.callId))
      .limit(1)
    const replay = existing[0]
    if (!replay) {
      throw new TypeError(`Simulated send ${input.callId} conflicted without a stored row`)
    }
    return replay
  })

type ReserveSendInput = {
  readonly approvalId: string
  readonly runId: string
  readonly callId: string
  readonly now: Date
  readonly reservationId: string
}

export const reserveSimulatedSend = async (database: DatabaseClient, input: ReserveSendInput) =>
  database.db.transaction(async (transaction) => {
    const rows = await transaction
      .select({ approval: approvalRequests, call: toolCalls, runStatus: runs.status })
      .from(approvalRequests)
      .innerJoin(toolCalls, eq(toolCalls.id, approvalRequests.callId))
      .innerJoin(runs, eq(runs.id, approvalRequests.runId))
      .where(eq(approvalRequests.id, input.approvalId))
      .for("update")
      .limit(1)
    const row = rows[0]
    if (
      row?.approval.status !== "approved" ||
      row.approval.runId !== input.runId ||
      row.approval.callId !== input.callId ||
      row.approval.expiresAt <= input.now ||
      row.runStatus === "completed" ||
      row.runStatus === "failed"
    ) {
      throw new InvalidApprovalError("approved execution binding mismatch")
    }
    const canonical = assertExactApprovalBinding(row.approval, row.call)
    const inserted = await transaction
      .insert(simulatedSends)
      .values({ callId: input.callId, messageId: input.reservationId, sentAt: input.now })
      .onConflictDoNothing()
      .returning({ callId: simulatedSends.callId })
    if (!inserted[0]) throw new DuplicateError("simulated send", input.callId)
    return { arguments: canonical.arguments, argumentsHash: canonical.hash }
  })

export const completeSimulatedSend = async (
  database: DatabaseClient,
  input: { readonly callId: string; readonly reservationId: string; readonly messageId: string },
): Promise<void> => {
  const updated = await database.db
    .update(simulatedSends)
    .set({ messageId: input.messageId })
    .where(
      and(
        eq(simulatedSends.callId, input.callId),
        eq(simulatedSends.messageId, input.reservationId),
      ),
    )
    .returning({ callId: simulatedSends.callId })
  if (!updated[0]) throw new DuplicateError("simulated send completion", input.callId)
}
