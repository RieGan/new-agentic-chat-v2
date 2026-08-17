import {
  CallIdSchema,
  ConflictError,
  JobIdSchema,
  parseContract,
  ReportIdSchema,
} from "@agentic-chat/contracts"
import { and, eq, max, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { dispatchIntents, jobEvents, jobs, runEvents, runs, toolCalls } from "../schema/index.js"
import {
  type ReportJobSnapshot,
  ReportToolResultSchema,
  toReportJobSnapshot,
} from "./report-job-records.js"

export type ReportJobTransitionInput = {
  readonly ledgerKey: string
  readonly eventId: string
  readonly runEventId: string
  readonly occurredAt: Date
}

type LockedJob = {
  readonly row: typeof jobs.$inferSelect
  readonly runSequence: number
  readonly runStatus: typeof runs.$inferSelect.status
  readonly runRuntime: typeof runs.$inferSelect.runtime
}

const lockJob = async (
  transaction: Parameters<Parameters<DatabaseClient["db"]["transaction"]>[0]>[0],
  ledgerKey: string,
): Promise<LockedJob> => {
  const selected = await transaction
    .select()
    .from(jobs)
    .where(eq(jobs.ledgerKey, ledgerKey))
    .for("update")
    .limit(1)
  const row = selected[0]
  if (!row) throw new ConflictError(`report job ${ledgerKey}`)
  const runRows = await transaction
    .select({ status: runs.status, runtime: runs.runtime })
    .from(runs)
    .where(eq(runs.id, row.runId))
    .for("update")
  const sequences = await transaction
    .select({ sequence: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.runId, row.runId))
  const run = runRows[0]
  if (!run) throw new ConflictError(`report run ${row.runId}`)
  return {
    row,
    runSequence: sequences[0]?.sequence ?? 0,
    runStatus: run.status,
    runRuntime: run.runtime,
  }
}

export const recordReportProgress = async (
  database: DatabaseClient,
  input: ReportJobTransitionInput,
): Promise<ReportJobSnapshot> =>
  database.db.transaction(async (transaction) => {
    const current = await lockJob(transaction, input.ledgerKey)
    if (current.row.status === "running" || current.row.status === "completed") {
      return toReportJobSnapshot(current.row)
    }
    if (current.row.status !== "queued") {
      throw new ConflictError(`report progress ${input.ledgerKey}`)
    }
    const updated = await transaction
      .update(jobs)
      .set({
        status: "running",
        percent: 50,
        version: sql`${jobs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(and(eq(jobs.ledgerKey, input.ledgerKey), eq(jobs.version, current.row.version)))
      .returning()
    const row = updated[0]
    if (!row) throw new ConflictError(`report progress ${input.ledgerKey}`)
    const payload = {
      jobId: parseContract(JobIdSchema, row.id),
      callId: parseContract(CallIdSchema, row.callId),
      status: "running",
      percent: 50,
    } as const
    await transaction.insert(jobEvents).values({
      id: input.eventId,
      jobKey: row.ledgerKey,
      sequence: 2,
      type: "job.progress",
      payload,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.runEventId,
      runId: row.runId,
      sequence: current.runSequence + 1,
      type: "job.progress",
      visibility: "user",
      payload,
      correlationId: row.callId,
      occurredAt: input.occurredAt,
    })
    return toReportJobSnapshot(row)
  })

export const completeReportJob = async (
  database: DatabaseClient,
  input: ReportJobTransitionInput & { readonly reportId: string },
): Promise<ReportJobSnapshot> =>
  database.db.transaction(async (transaction) => {
    const reportId = parseContract(ReportIdSchema, input.reportId)
    const current = await lockJob(transaction, input.ledgerKey)
    if (current.row.status === "completed") {
      const snapshot = toReportJobSnapshot(current.row)
      if (snapshot.reportId !== reportId)
        throw new ConflictError(`report result ${input.ledgerKey}`)
      return snapshot
    }
    if (current.row.status !== "running" || current.row.percent !== 50) {
      throw new ConflictError(`report completion ${input.ledgerKey}`)
    }
    const result = parseContract(ReportToolResultSchema, {
      toolName: "report.generate",
      jobId: current.row.id,
      reportId,
      status: "completed",
    })
    const updated = await transaction
      .update(jobs)
      .set({
        status: "completed",
        percent: 100,
        result,
        version: sql`${jobs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(and(eq(jobs.ledgerKey, input.ledgerKey), eq(jobs.version, current.row.version)))
      .returning()
    const row = updated[0]
    if (!row) throw new ConflictError(`report completion ${input.ledgerKey}`)
    await transaction
      .update(toolCalls)
      .set({
        status: "completed",
        result,
        version: sql`${toolCalls.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(and(eq(toolCalls.id, row.callId), eq(toolCalls.status, "waiting_job")))
    const payload = {
      jobId: parseContract(JobIdSchema, row.id),
      callId: parseContract(CallIdSchema, row.callId),
      status: "completed",
      reportId,
    } as const
    await transaction.insert(jobEvents).values({
      id: input.eventId,
      jobKey: row.ledgerKey,
      sequence: 3,
      type: "job.completed",
      payload,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.runEventId,
      runId: row.runId,
      sequence: current.runSequence + 1,
      type: "job.completed",
      visibility: "user",
      payload,
      correlationId: row.callId,
      occurredAt: input.occurredAt,
    })
    if (current.runStatus === "waiting_for_tool" && current.runRuntime === "simple_loop") {
      await transaction.insert(dispatchIntents).values({
        id: `${row.ledgerKey}-resume`,
        aggregateType: "run",
        aggregateId: row.runId,
        deduplicationKey: `${row.runId}:report:${row.ledgerKey}:completed`,
        topic: "simple_loop.execute",
        payload: { runId: row.runId, runtime: "simple_loop", jobId: row.id },
        availableAt: input.occurredAt,
        createdAt: input.occurredAt,
      })
    }
    if (current.runStatus === "waiting_for_tool" && current.runRuntime === "state_workflow") {
      await transaction.insert(dispatchIntents).values({
        id: `${row.ledgerKey}-workflow-signal`,
        aggregateType: "run",
        aggregateId: row.runId,
        deduplicationKey: `${row.runId}:workflow-report:${row.ledgerKey}:completed`,
        topic: "state_workflow.signal",
        payload: {
          kind: "job_completion",
          runId: row.runId,
          callId: row.callId,
          jobId: row.id,
          outcome: "completed",
        },
        availableAt: input.occurredAt,
        createdAt: input.occurredAt,
      })
    }
    return toReportJobSnapshot(row)
  })

export const readReportJob = async (
  database: DatabaseClient,
  scope: { readonly namespace: string; readonly runId: string; readonly jobId: string },
): Promise<ReportJobSnapshot | null> => {
  const rows = await database.db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.namespace, scope.namespace),
        eq(jobs.runId, scope.runId),
        eq(jobs.id, scope.jobId),
      ),
    )
    .limit(1)
  return rows[0] ? toReportJobSnapshot(rows[0]) : null
}
