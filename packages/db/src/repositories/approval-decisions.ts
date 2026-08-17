import {
  CanonicalEventSchema,
  InvalidApprovalError,
  parseContract,
  StaleVersionError,
} from "@agentic-chat/contracts"
import { and, eq, max, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import {
  approvalActions,
  approvalRequests,
  dispatchIntents,
  runEvents,
  runs,
  toolCalls,
} from "../schema/index.js"
import { assertExactApprovalBinding } from "./approval-bindings.js"
import {
  type ApprovalDecisionInput,
  type ApprovalSnapshotRecord,
  toApprovalSnapshot,
} from "./approvals.js"

const decideInsideTransaction = async (
  database: DatabaseClient,
  input: ApprovalDecisionInput,
): Promise<ApprovalSnapshotRecord | { readonly expired: true }> =>
  database.db.transaction(async (transaction) => {
    const approvalRows = await transaction
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, input.approvalId))
      .for("update")
      .limit(1)
    const approval = approvalRows[0]
    if (!approval) throw new InvalidApprovalError("approval not found")
    const runRows = await transaction
      .select({ status: runs.status, runtime: runs.runtime })
      .from(runs)
      .where(eq(runs.id, approval.runId))
      .for("update")
      .limit(1)
    const callRows = await transaction
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.id, approval.callId))
      .for("update")
      .limit(1)
    const run = runRows[0]
    const call = callRows[0]
    const decidedAt = input.decidedAt ?? new Date()
    if (approval.status === "pending" && approval.expiresAt <= decidedAt) {
      await transaction
        .update(approvalRequests)
        .set({
          status: "expired",
          version: sql`${approvalRequests.version} + 1`,
          updatedAt: decidedAt,
        })
        .where(eq(approvalRequests.id, approval.id))
      return { expired: true }
    }
    if (
      approval.status !== "pending" ||
      approval.callId !== input.callId ||
      approval.requiredActorId !== input.actorId ||
      approval.argumentsHash !== input.expectedArgumentsHash ||
      !run ||
      run.status === "completed" ||
      run.status === "failed" ||
      !call ||
      call.status !== "approval_required"
    ) {
      throw new InvalidApprovalError("approval binding mismatch")
    }
    if (approval.version !== input.expectedVersion) {
      throw new StaleVersionError(input.expectedVersion, approval.version)
    }
    assertExactApprovalBinding(approval, call)
    const outcome = (() => {
      switch (input.decision) {
        case "approved":
          return { callStatus: "running", reason: null } as const
        case "rejected":
          return { callStatus: "rejected", reason: input.reason } as const
        default: {
          const exhaustiveDecision: never = input
          return exhaustiveDecision
        }
      }
    })()
    const updatedRows = await transaction
      .update(approvalRequests)
      .set({
        status: input.decision,
        version: sql`${approvalRequests.version} + 1`,
        updatedAt: decidedAt,
      })
      .where(
        and(
          eq(approvalRequests.id, approval.id),
          eq(approvalRequests.version, input.expectedVersion),
        ),
      )
      .returning()
    const updated = updatedRows[0]
    if (!updated) throw new StaleVersionError(input.expectedVersion, approval.version)
    await transaction.insert(approvalActions).values({
      id: input.actionId,
      approvalId: approval.id,
      callId: approval.callId,
      actorId: input.actorId,
      decision: input.decision,
      reason: outcome.reason,
      decidedAt,
    })
    await transaction
      .update(toolCalls)
      .set({
        status: outcome.callStatus,
        version: sql`${toolCalls.version} + 1`,
        updatedAt: decidedAt,
      })
      .where(eq(toolCalls.id, approval.callId))
    const sequences = await transaction
      .select({ sequence: max(runEvents.sequence) })
      .from(runEvents)
      .where(eq(runEvents.runId, approval.runId))
    const sequence = (sequences[0]?.sequence ?? 0) + 1
    const event = parseContract(CanonicalEventSchema, {
      eventId: `${input.actionId}-event`,
      runId: approval.runId,
      sequence,
      type: input.decision === "approved" ? "approval.approved" : "approval.rejected",
      visibility: "admin",
      payload: {
        approvalId: approval.id,
        callId: approval.callId,
        actorId: input.actorId,
        ...(input.decision === "rejected" ? { reason: input.reason } : {}),
      },
      correlationId: approval.callId,
      occurredAt: decidedAt.toISOString(),
    })
    await transaction.insert(runEvents).values({
      id: event.eventId,
      runId: approval.runId,
      sequence,
      type: event.type,
      visibility: event.visibility,
      payload: event.payload,
      correlationId: approval.callId,
      occurredAt: decidedAt,
    })
    if (run.status === "waiting_for_admin") {
      await transaction.insert(dispatchIntents).values({
        id: `${input.actionId}-resume`,
        aggregateType: "run",
        aggregateId: approval.runId,
        deduplicationKey: `${approval.runId}:approval:${approval.id}:${input.decision}`,
        topic: run.runtime === "simple_loop" ? "simple_loop.execute" : "state_workflow.signal",
        payload:
          run.runtime === "simple_loop"
            ? { runId: approval.runId, runtime: "simple_loop", approvalId: approval.id }
            : {
                kind: "admin_decision",
                runId: approval.runId,
                callId: approval.callId,
                approvalId: approval.id,
                decision: input.decision,
              },
        availableAt: decidedAt,
        createdAt: decidedAt,
      })
    }
    return toApprovalSnapshot(updated, {
      decidedAt,
      ...(outcome.reason === null ? {} : { reason: outcome.reason }),
    })
  })

export const decideApproval = async (
  database: DatabaseClient,
  input: ApprovalDecisionInput,
): Promise<ApprovalSnapshotRecord> => {
  const result = await decideInsideTransaction(database, input)
  if ("expired" in result) throw new InvalidApprovalError("approval expired")
  return result
}
