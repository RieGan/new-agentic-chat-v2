import { CanonicalEventSchema, parseContract } from "@agentic-chat/contracts"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import {
  dispatchIntents,
  idempotencyKeys,
  jobEvents,
  jobs,
  runEvents,
  toolCalls,
} from "../schema/index.js"
import type { ReportJobIdentity } from "./report-job-records.js"
import { lockSimpleLoopLease, nextSimpleLoopSequence } from "./simple-loop-lock.js"
import { releaseForSimpleLoopWait, type WaitTransition } from "./simple-loop-wait-base.js"

export type PersistReportWaitInput = WaitTransition &
  ReportJobIdentity & {
    readonly arguments: JsonValue
    readonly argumentsHash: string
    readonly acceptedEventId: string
    readonly runAcceptedEventId: string
    readonly dispatchId: string
  }

export const persistSimpleLoopReportWait = async (
  database: DatabaseClient,
  input: PersistReportWaitInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockSimpleLoopLease(transaction, input)
    await transaction.insert(idempotencyKeys).values({
      key: `report.generate/${input.namespace}/${input.runId}/${input.callId}`,
      scope: "report.generate",
      requestHash: input.argumentsHash,
      response: { jobId: input.jobId, status: "queued" },
      createdAt: input.occurredAt,
    })
    await transaction.insert(toolCalls).values({
      id: input.callId,
      runId: input.runId,
      toolId: "report.generate",
      toolVersion: "1",
      status: "waiting_job",
      arguments: input.arguments,
      argumentsHash: input.argumentsHash,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    await transaction.insert(jobs).values({
      ledgerKey: input.ledgerKey,
      namespace: input.namespace,
      id: input.jobId,
      runId: input.runId,
      callId: input.callId,
      bullmqJobId: input.bullmqJobId,
      workflowIdentity: `bullmq/${input.bullmqJobId}`,
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
    })
    await transaction.insert(jobEvents).values({
      id: input.acceptedEventId,
      jobKey: input.ledgerKey,
      sequence: 1,
      type: "job.accepted",
      payload: { jobId: input.jobId, callId: input.callId, status: "queued" },
      occurredAt: input.occurredAt,
    })
    const acceptedEvent = parseContract(CanonicalEventSchema, {
      eventId: input.runAcceptedEventId,
      runId: input.runId,
      sequence: await nextSimpleLoopSequence(transaction, input.runId),
      type: "job.accepted",
      visibility: "user",
      payload: { jobId: input.jobId, callId: input.callId, status: "queued" },
      correlationId: input.callId,
      occurredAt: input.occurredAt.toISOString(),
    })
    await transaction.insert(runEvents).values({
      id: acceptedEvent.eventId,
      runId: input.runId,
      sequence: acceptedEvent.sequence,
      type: acceptedEvent.type,
      visibility: acceptedEvent.visibility,
      payload: acceptedEvent.payload,
      correlationId: input.callId,
      occurredAt: input.occurredAt,
    })
    await transaction.insert(dispatchIntents).values({
      id: input.dispatchId,
      aggregateType: "report_job",
      aggregateId: input.ledgerKey,
      deduplicationKey: `report-job/${input.ledgerKey}`,
      topic: "report.generate",
      payload: {
        namespace: input.namespace,
        ledgerKey: input.ledgerKey,
        runId: input.runId,
        callId: input.callId,
        jobId: input.jobId,
        reportId: input.reportId,
        bullmqJobId: input.bullmqJobId,
      },
      availableAt: input.occurredAt,
      createdAt: input.occurredAt,
    })
    return { version: await releaseForSimpleLoopWait(transaction, input, "waiting_for_tool") }
  })
