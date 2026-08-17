import {
  ConflictError,
  parseContract,
  ReportGenerateArgumentsSchema,
} from "@agentic-chat/contracts"
import { and, eq, max } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import {
  dispatchIntents,
  idempotencyKeys,
  jobEvents,
  jobs,
  runEvents,
  runs,
  toolCalls,
} from "../schema/index.js"
import {
  type AdmitReportJobInput,
  ReportJobIdentitySchema,
  type ReportJobSnapshot,
  toReportJobSnapshot,
} from "./report-job-records.js"

export type {
  AdmitReportJobInput,
  ReportJobIdentity,
  ReportJobSnapshot,
} from "./report-job-records.js"

export const admitReportJob = async (
  database: DatabaseClient,
  input: AdmitReportJobInput,
): Promise<ReportJobSnapshot> =>
  database.db.transaction(async (transaction) => {
    const identity = parseContract(ReportJobIdentitySchema, {
      namespace: input.namespace,
      ledgerKey: input.ledgerKey,
      runId: input.runId,
      callId: input.callId,
      jobId: input.jobId,
      reportId: input.reportId,
      bullmqJobId: input.bullmqJobId,
    })
    const arguments_ = parseContract(ReportGenerateArgumentsSchema, input.arguments)
    const selectedRun = await transaction
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.id, identity.runId))
      .for("update")
      .limit(1)
    if (!selectedRun[0]) throw new ConflictError(`report run ${identity.runId}`)

    const idempotencyKey = `report.generate/${identity.namespace}/${identity.runId}/${identity.callId}`
    const reserved = await transaction
      .insert(idempotencyKeys)
      .values({
        key: idempotencyKey,
        scope: "report.generate",
        requestHash: input.argumentsHash,
        response: { jobId: identity.jobId, status: "queued" },
        createdAt: input.occurredAt,
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key })
    if (!reserved[0]) {
      const existingReservation = await transaction
        .select({
          scope: idempotencyKeys.scope,
          requestHash: idempotencyKeys.requestHash,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1)
      const reservation = existingReservation[0]
      if (
        reservation?.scope !== "report.generate" ||
        reservation.requestHash !== input.argumentsHash
      ) {
        throw new ConflictError(`report admission ${idempotencyKey}`)
      }
      const replay = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.namespace, identity.namespace),
            eq(jobs.runId, identity.runId),
            eq(jobs.id, identity.jobId),
          ),
        )
        .limit(1)
      const replayed = replay[0]
      if (!replayed || replayed.callId !== identity.callId) {
        throw new ConflictError(`report job ${identity.ledgerKey}`)
      }
      return toReportJobSnapshot(replayed)
    }

    await transaction.insert(toolCalls).values({
      id: identity.callId,
      runId: identity.runId,
      toolId: "report.generate",
      toolVersion: "1",
      status: "waiting_job",
      arguments: arguments_,
      argumentsHash: input.argumentsHash,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    const insertedJobs = await transaction
      .insert(jobs)
      .values({
        ledgerKey: identity.ledgerKey,
        namespace: identity.namespace,
        id: identity.jobId,
        runId: identity.runId,
        callId: identity.callId,
        bullmqJobId: identity.bullmqJobId,
        workflowIdentity: `bullmq/${identity.bullmqJobId}`,
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      })
      .returning()
    const inserted = insertedJobs[0]
    if (!inserted) throw new ConflictError(`report job ${identity.ledgerKey}`)
    await transaction.insert(jobEvents).values({
      id: input.acceptedEventId,
      jobKey: identity.ledgerKey,
      sequence: 1,
      type: "job.accepted",
      payload: { jobId: identity.jobId, callId: identity.callId, status: "queued" },
      occurredAt: input.occurredAt,
    })
    const sequenceRows = await transaction
      .select({ sequence: max(runEvents.sequence) })
      .from(runEvents)
      .where(eq(runEvents.runId, identity.runId))
    await transaction.insert(runEvents).values({
      id: input.runEventId,
      runId: identity.runId,
      sequence: (sequenceRows[0]?.sequence ?? 0) + 1,
      type: "job.accepted",
      visibility: "user",
      payload: { jobId: identity.jobId, callId: identity.callId, status: "queued" },
      correlationId: identity.callId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(dispatchIntents).values({
      id: input.dispatchId,
      aggregateType: "report_job",
      aggregateId: identity.ledgerKey,
      deduplicationKey: `report-job/${identity.ledgerKey}`,
      topic: "report.generate",
      payload: {
        namespace: identity.namespace,
        ledgerKey: identity.ledgerKey,
        runId: identity.runId,
        callId: identity.callId,
        jobId: identity.jobId,
        reportId: identity.reportId,
        bullmqJobId: identity.bullmqJobId,
      },
      availableAt: input.occurredAt,
      createdAt: input.occurredAt,
    })
    return toReportJobSnapshot(inserted)
  })
