import { createHash } from "node:crypto"

import {
  CallIdSchema,
  ConflictError,
  JobIdSchema,
  parseContract,
  ReportGenerateArgumentsSchema,
  RunIdSchema,
} from "@agentic-chat/contracts"
import {
  admitReportJob,
  listPendingReportDispatches,
  markReportDispatched,
  type ReportJobIdentity,
  readReportJob,
} from "@agentic-chat/db"
import type { ToolRegistry } from "@agentic-chat/tools"
import { z } from "zod"

import type { ApplicationDependencies } from "./dependencies.js"

export interface ReportJobQueue {
  enqueue(payload: ReportJobIdentity): Promise<void>
}

interface ReportAdmissionTestControls {
  afterAccepted(): Promise<void>
}

type ReportJobServiceConfiguration =
  | { readonly mode: "production" }
  | { readonly mode: "test"; readonly controls: ReportAdmissionTestControls }

export type ReportJobServiceDependencies = ApplicationDependencies & {
  readonly queue: ReportJobQueue
  readonly tools: ToolRegistry
}

const ReportAdmissionInputSchema = z
  .object({
    namespace: z.string().trim().min(1).max(64),
    runId: RunIdSchema,
    callId: CallIdSchema,
    arguments: ReportGenerateArgumentsSchema,
  })
  .strict()

const ReportAdmissionReceiptSchema = z
  .object({ jobId: JobIdSchema, status: z.literal("queued") })
  .strict()
const ReportStatusScopeSchema = z
  .object({ namespace: z.string().trim().min(1).max(64), runId: RunIdSchema, jobId: JobIdSchema })
  .strict()

const deriveIdentity = (input: z.output<typeof ReportAdmissionInputSchema>): ReportJobIdentity => {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.namespace, input.runId, input.callId]))
    .digest("hex")
    .slice(0, 24)
  return {
    namespace: input.namespace,
    ledgerKey: `report-job-${digest}`,
    runId: input.runId,
    callId: input.callId,
    jobId: "job_001",
    reportId: "report_001",
    bullmqJobId: `report-${digest}`,
  }
}

const createConfiguredReportJobService = (
  dependencies: ReportJobServiceDependencies & {
    readonly configuration: ReportJobServiceConfiguration
  },
) => {
  if (dependencies.configuration.mode === "test" && process.env["NODE_ENV"] !== "test") {
    throw new TypeError("Report job test controls require NODE_ENV=test")
  }
  const dispatch = async (intentId: string, payload: ReportJobIdentity): Promise<void> => {
    await dependencies.queue.enqueue(payload)
    await markReportDispatched(dependencies.database, {
      intentId,
      dispatchedAt: dependencies.clock.now(),
    })
  }
  return {
    admit: async (input: unknown) => {
      const parsed = parseContract(ReportAdmissionInputSchema, input)
      const identity = deriveIdentity(parsed)
      const digest = createHash("sha256").update(JSON.stringify(parsed.arguments)).digest("hex")
      const eventPrefix = `report-${identity.bullmqJobId.slice("report-".length)}`
      await admitReportJob(dependencies.database, {
        ...identity,
        arguments: parsed.arguments,
        argumentsHash: digest,
        acceptedEventId: `${eventPrefix}-accepted`,
        runEventId: `${eventPrefix}-run-accepted`,
        dispatchId: `${eventPrefix}-dispatch`,
        occurredAt: dependencies.clock.now(),
      })
      if (dependencies.configuration.mode === "test") {
        await dependencies.configuration.controls.afterAccepted()
      }
      await dispatch(`${eventPrefix}-dispatch`, identity)
      return parseContract(ReportAdmissionReceiptSchema, {
        jobId: identity.jobId,
        status: "queued",
      })
    },
    dispatchPending: async (): Promise<void> => {
      const pending = await listPendingReportDispatches(dependencies.database)
      for (const intent of pending) await dispatch(intent.intentId, intent.payload)
    },
    getStatus: async (input: unknown) => {
      const scope = parseContract(ReportStatusScopeSchema, input)
      const snapshot = await readReportJob(dependencies.database, scope)
      if (!snapshot) throw new ConflictError(`report status ${scope.jobId}`)
      return dependencies.tools.getJobStatus(
        { jobId: scope.jobId },
        {
          lookup: () => ({
            jobId: snapshot.identity.jobId,
            status: snapshot.status,
            ...(snapshot.reportId ? { reportId: snapshot.reportId } : {}),
          }),
        },
      )
    },
  }
}

export const createReportJobService = (dependencies: ReportJobServiceDependencies) =>
  createConfiguredReportJobService({ ...dependencies, configuration: { mode: "production" } })

export const createReportJobTestService = (
  dependencies: ReportJobServiceDependencies & { readonly controls: ReportAdmissionTestControls },
) =>
  createConfiguredReportJobService({
    ...dependencies,
    configuration: { mode: "test", controls: dependencies.controls },
  })
