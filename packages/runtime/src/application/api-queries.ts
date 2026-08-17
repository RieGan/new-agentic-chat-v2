import {
  ApprovalEnvelopeSchema,
  ApprovalGetInputSchema,
  ApprovalListPendingInputSchema,
  ConflictError,
  ConversationGetInputSchema,
  ConversationProjectionSchema,
  JobEnvelopeSchema,
  JobGetInputSchema,
  JobIdSchema,
  NotificationSendArgumentsSchema,
  parseContract,
  ReportIdSchema,
  RunEventsInputSchema,
  RunGetInputSchema,
  RunProjectionSchema,
  RunsListInputSchema,
  RunsListOutputSchema,
  SkillGetInputSchema,
  SkillSnapshotSchema,
} from "@agentic-chat/contracts"
import {
  type ApprovalSnapshotRecord,
  type DatabaseClient,
  listApiApprovalRecords,
  listApiRunIds,
  readApiApprovalRecord,
  readApiJobRecord,
  readApiSkillRecord,
  readConversationApiProjection,
} from "@agentic-chat/db"
import { z } from "zod"

import { toApprovalEnvelope } from "./approvals.js"
import { createProjectionService } from "./projections.js"

const completedJobResultSchema = z
  .object({
    toolName: z.literal("report.generate"),
    jobId: JobIdSchema,
    reportId: ReportIdSchema,
    status: z.literal("completed"),
  })
  .strict()

const toApprovalSnapshot = (
  row: Awaited<ReturnType<typeof readApiApprovalRecord>>,
): ApprovalSnapshotRecord => {
  if (!row) throw new ConflictError("approval")
  return {
    approvalId: row.approval.id,
    runId: row.approval.runId,
    callId: row.approval.callId,
    toolVersion: row.approval.toolVersion,
    arguments: parseContract(NotificationSendArgumentsSchema, row.approval.arguments),
    argumentsHash: row.approval.argumentsHash,
    status: row.approval.status,
    version: row.approval.version,
    expiresAt: row.approval.expiresAt,
    ...(row.action ? { decidedAt: row.action.decidedAt } : {}),
    ...(row.action?.reason ? { reason: row.action.reason } : {}),
  }
}

export const createApiQueryService = (database: DatabaseClient) => {
  const projections = createProjectionService(database)
  return {
    conversation: async (input: unknown) => {
      const parsed = parseContract(ConversationGetInputSchema, input)
      const record = await readConversationApiProjection(database, parsed.conversationId)
      if (!record) throw new ConflictError(`conversation ${parsed.conversationId}`)
      const runProjections = await Promise.all(
        record.runIds.map((runId) => projections.get({ viewer: "user", runId })),
      )
      return parseContract(ConversationProjectionSchema, {
        conversationId: parsed.conversationId,
        messages: record.messages.map((message) => ({
          messageId: message.id,
          ...(message.runId ? { runId: message.runId } : {}),
          actor: message.actor,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
        })),
        runs: runProjections.map((projection) => projection.run),
      })
    },
    runs: async (input: unknown) => {
      const parsed = parseContract(RunsListInputSchema, input)
      const rows = await listApiRunIds(database, {
        ...(parsed.runtime === undefined ? {} : { runtime: parsed.runtime }),
        ...(parsed.status === undefined ? {} : { status: parsed.status }),
      })
      const values = await Promise.all(
        rows.map(async ({ runId }) => (await projections.get({ viewer: "admin", runId })).run),
      )
      return parseContract(RunsListOutputSchema, values)
    },
    run: async (viewer: "user" | "admin", input: unknown) => {
      const parsed = parseContract(RunGetInputSchema, input)
      return parseContract(
        RunProjectionSchema,
        await projections.get({ viewer, runId: parsed.runId }),
      )
    },
    events: async (viewer: "user" | "admin", input: unknown) => {
      const parsed = parseContract(RunEventsInputSchema, input)
      return projections.events({ viewer, ...parsed })
    },
    pendingApprovals: async (input: unknown) => {
      const parsed = parseContract(ApprovalListPendingInputSchema, input)
      const rows = await listApiApprovalRecords(database, parsed.runId)
      return z.array(ApprovalEnvelopeSchema).parse(
        rows
          .map((row) => toApprovalSnapshot(row))
          .filter((approval) => approval.status === "pending")
          .map(toApprovalEnvelope),
      )
    },
    approval: async (input: unknown) => {
      const parsed = parseContract(ApprovalGetInputSchema, input)
      return parseContract(
        ApprovalEnvelopeSchema,
        toApprovalEnvelope(
          toApprovalSnapshot(await readApiApprovalRecord(database, parsed.approvalId)),
        ),
      )
    },
    job: async (input: unknown) => {
      const parsed = parseContract(JobGetInputSchema, input)
      const row = await readApiJobRecord(database, parsed.jobId)
      if (!row) throw new ConflictError(`job ${parsed.jobId}`)
      const result =
        row.status === "completed" ? parseContract(completedJobResultSchema, row.result) : undefined
      return parseContract(JobEnvelopeSchema, {
        jobId: row.id,
        runId: row.runId,
        callId: row.callId,
        status: row.status,
        version: row.version,
        ...(row.status === "running" ? { percent: row.percent } : {}),
        ...(result ? { reportId: result.reportId } : {}),
        ...(row.status === "failed" ? { error: row.error } : {}),
      })
    },
    skill: async (input: unknown) => {
      const parsed = parseContract(SkillGetInputSchema, input)
      const row = await readApiSkillRecord(database, parsed)
      if (!row) throw new ConflictError(`skill ${parsed.skillId}@${parsed.version}`)
      return parseContract(SkillSnapshotSchema, {
        skillId: row.skillId,
        version: row.version,
        instructions: row.instructions,
        allowedTools: row.allowedTools,
      })
    },
  }
}
