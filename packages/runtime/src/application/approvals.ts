import {
  ApprovalDecisionInputSchema,
  ApprovalEnvelopeSchema,
  ApprovalIdSchema,
  CallIdSchema,
  InvalidApprovalError,
  NotificationSendArgumentsSchema,
  parseContract,
  RunIdSchema,
  TimestampSchema,
} from "@agentic-chat/contracts"
import {
  type ApprovalSnapshotRecord,
  completeSimulatedSend,
  decideApproval,
  prepareApproval,
  reserveSimulatedSend,
} from "@agentic-chat/db"
import { hashApprovedArguments, type ToolRegistry } from "@agentic-chat/tools"
import { createApprovalAuthorizationIssuer } from "@agentic-chat/tools/approval-internal"
import { z } from "zod"

import { requireFixedAdmin } from "./admin-context.js"
import type { ApplicationDependencies } from "./dependencies.js"

const PrepareApprovalInputSchema = z
  .object({ runId: RunIdSchema, callId: CallIdSchema, expiresAt: TimestampSchema })
  .strict()
const ExecuteApprovalInputSchema = z
  .object({ runId: RunIdSchema, approvalId: ApprovalIdSchema, callId: CallIdSchema })
  .strict()
const NotificationSendResultSchema = z
  .object({
    toolName: z.literal("notification.send_email"),
    messageId: z.string().trim().min(1),
    status: z.literal("sent"),
  })
  .strict()

type ApprovalServiceDependencies = ApplicationDependencies & { readonly tools: ToolRegistry }

export const toApprovalEnvelope = (record: ApprovalSnapshotRecord) => {
  const base = {
    approvalId: record.approvalId,
    runId: record.runId,
    callId: record.callId,
    toolName: "notification.send_email",
    arguments: record.arguments,
    argumentsHash: record.argumentsHash,
    requiredActor: "mvp_admin",
    expiresAt: record.expiresAt.toISOString(),
    version: record.version,
  } as const
  switch (record.status) {
    case "pending":
      return parseContract(ApprovalEnvelopeSchema, { ...base, status: record.status })
    case "approved":
      return parseContract(ApprovalEnvelopeSchema, {
        ...base,
        status: record.status,
        decidedBy: "mvp_admin",
        ...(record.decidedAt ? { decidedAt: record.decidedAt.toISOString() } : {}),
      })
    case "rejected":
      return parseContract(ApprovalEnvelopeSchema, {
        ...base,
        status: record.status,
        decidedBy: "mvp_admin",
        ...(record.decidedAt ? { decidedAt: record.decidedAt.toISOString() } : {}),
        ...(record.reason ? { reason: record.reason } : {}),
      })
    case "expired":
      return parseContract(ApprovalEnvelopeSchema, {
        ...base,
        status: record.status,
        expiredAt: (record.expiredAt ?? record.expiresAt).toISOString(),
      })
    default: {
      const exhaustiveStatus: never = record.status
      return exhaustiveStatus
    }
  }
}

export const createApprovalService = (dependencies: ApprovalServiceDependencies) => {
  const issuer = createApprovalAuthorizationIssuer()
  return {
    prepare: async (input: unknown) => {
      const parsed = parseContract(PrepareApprovalInputSchema, input)
      const record = await prepareApproval(dependencies.database, {
        approvalId: parseContract(ApprovalIdSchema, dependencies.ids.next("approval")),
        runId: parsed.runId,
        callId: parsed.callId,
        expiresAt: new Date(parsed.expiresAt),
        now: dependencies.clock.now(),
      })
      return toApprovalEnvelope(record)
    },
    decide: async (context: unknown, input: unknown) => {
      requireFixedAdmin(context, () => new InvalidApprovalError("fixed Admin context required"))
      const parsed = parseContract(ApprovalDecisionInputSchema, input)
      const identity = {
        approvalId: parsed.approvalId,
        callId: parsed.callId,
        actionId: dependencies.ids.next("approval_action"),
        actorId: "mvp_admin" as const,
        expectedArgumentsHash: parsed.expectedArgumentsHash,
        expectedVersion: parsed.expectedVersion,
        decidedAt: dependencies.clock.now(),
      }
      switch (parsed.decision) {
        case "approve":
          return toApprovalEnvelope(
            await decideApproval(dependencies.database, { ...identity, decision: "approved" }),
          )
        case "reject":
          return toApprovalEnvelope(
            await decideApproval(dependencies.database, {
              ...identity,
              decision: "rejected",
              reason: parsed.reason,
            }),
          )
        default: {
          const exhaustiveDecision: never = parsed
          return exhaustiveDecision
        }
      }
    },
    execute: async (input: unknown) => {
      const parsed = parseContract(ExecuteApprovalInputSchema, input)
      const reservationId = dependencies.ids.next("send_reservation")
      const approved = await reserveSimulatedSend(dependencies.database, {
        ...parsed,
        now: dependencies.clock.now(),
        reservationId,
      })
      const arguments_ = parseContract(NotificationSendArgumentsSchema, approved.arguments)
      if (hashApprovedArguments(arguments_) !== approved.argumentsHash) {
        throw new InvalidApprovalError("execution hash mismatch")
      }
      const selected = dependencies.tools.loadSkill({
        skillId: "communication_assistant",
        version: "1",
      })
      if (!selected.ok) throw new InvalidApprovalError("approved skill snapshot unavailable")
      const authorization = issuer.issue({
        callId: parsed.callId,
        argumentsHash: approved.argumentsHash,
      })
      const result = parseContract(
        NotificationSendResultSchema,
        dependencies.tools.executeApprovedSend(
          selected.skill,
          { callId: parsed.callId, arguments: arguments_ },
          authorization,
        ),
      )
      await completeSimulatedSend(dependencies.database, {
        callId: parsed.callId,
        reservationId,
        messageId: result.messageId,
      })
      return result
    },
  }
}
