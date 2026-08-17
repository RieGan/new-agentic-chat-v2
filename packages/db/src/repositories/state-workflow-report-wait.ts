import { CallIdSchema, JobIdSchema, parseContract } from "@agentic-chat/contracts"

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
import { lockStateWorkflowRun, nextStateWorkflowSequence } from "./state-workflow-lock.js"
import {
  enterStateWorkflowWait,
  type StateWorkflowWaitTransition,
} from "./state-workflow-wait-base.js"

export type PersistStateWorkflowReportWaitInput = StateWorkflowWaitTransition &
  ReportJobIdentity & {
    readonly arguments: JsonValue
    readonly argumentsHash: string
    readonly acceptedEventId: string
    readonly runAcceptedEventId: string
    readonly dispatchId: string
  }

export const persistStateWorkflowReportWait = async (
  database: DatabaseClient,
  input: PersistStateWorkflowReportWaitInput,
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockStateWorkflowRun(transaction, input)
    const callId = parseContract(CallIdSchema, input.callId)
    const jobId = parseContract(JobIdSchema, input.jobId)
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
      payload: { jobId, callId, status: "queued" },
      occurredAt: input.occurredAt,
    })
    await transaction.insert(runEvents).values({
      id: input.runAcceptedEventId,
      runId: input.runId,
      sequence: await nextStateWorkflowSequence(transaction, input.runId),
      type: "job.accepted",
      visibility: "user",
      payload: { jobId, callId, status: "queued" },
      correlationId: callId,
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
    return {
      version: await enterStateWorkflowWait(transaction, input, "waiting_for_tool"),
    }
  })
