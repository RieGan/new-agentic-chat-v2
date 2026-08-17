import {
  CallIdSchema,
  JobIdSchema,
  parseContract,
  ReportIdSchema,
  RunIdSchema,
} from "@agentic-chat/contracts"
import { completeReportJob, type ReportJobIdentity, recordReportProgress } from "@agentic-chat/db"
import { type Job, Queue, Worker } from "bullmq"
import { z } from "zod"

import type { Clock } from "../application/dependencies.js"

export const REPORT_QUEUE_NAME = "fixture-reports"

const ReportQueuePayloadSchema = z
  .object({
    namespace: z.string().trim().min(1),
    ledgerKey: z.string().trim().min(1),
    runId: RunIdSchema,
    callId: CallIdSchema,
    jobId: JobIdSchema,
    reportId: ReportIdSchema,
    bullmqJobId: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.includes(":")),
  })
  .strict()

interface ReportWorkerTestControls {
  beforeCompletion(): Promise<void>
  takeCrashAfterProgress(): boolean
  readonly duplicateDelivery: boolean
  afterCompleted(): Promise<void>
}

type ReportWorkerConfiguration =
  | { readonly mode: "production" }
  | { readonly mode: "test"; readonly controls: ReportWorkerTestControls }

type RedisConnection = {
  readonly host: string
  readonly port: number
  readonly username?: string
  readonly password?: string
  readonly db: number
  readonly maxRetriesPerRequest: null
}

const redisConnection = (redisUrl: string): RedisConnection => {
  const url = new URL(redisUrl)
  const database = url.pathname === "" || url.pathname === "/" ? 0 : Number(url.pathname.slice(1))
  if (url.protocol !== "redis:" || !Number.isSafeInteger(database) || database < 0) {
    throw new TypeError("Report queue requires a valid redis:// URL")
  }
  return {
    host: url.hostname,
    port: url.port === "" ? 6379 : Number(url.port),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    db: database,
    maxRetriesPerRequest: null,
  }
}

export const createBullReportQueue = (input: {
  readonly redisUrl: string
  readonly queueName?: string
}) => {
  const queue = new Queue<ReportJobIdentity>(input.queueName ?? REPORT_QUEUE_NAME, {
    connection: redisConnection(input.redisUrl),
  })
  return {
    enqueue: async (payload: ReportJobIdentity): Promise<void> => {
      const parsed = parseContract(ReportQueuePayloadSchema, payload)
      await queue.add("report.generate", parsed, {
        jobId: parsed.bullmqJobId,
        attempts: 2,
        backoff: { type: "fixed", delay: 1 },
        removeOnComplete: false,
        removeOnFail: false,
      })
    },
    close: async (): Promise<void> => queue.close(),
  }
}

export class InjectedReportWorkerCrashError extends Error {
  readonly name = "InjectedReportWorkerCrashError"
}

type ReportFixtureWorkerInput = {
  readonly redisUrl: string
  readonly queueName?: string
  readonly database: Parameters<typeof recordReportProgress>[0]
  readonly clock: Clock
}

const createConfiguredReportFixtureWorker = (
  input: ReportFixtureWorkerInput & { readonly configuration: ReportWorkerConfiguration },
) => {
  if (input.configuration.mode === "test" && process.env["NODE_ENV"] !== "test") {
    throw new TypeError("Report worker test controls require NODE_ENV=test")
  }
  const worker = new Worker<ReportJobIdentity, { readonly reportId: string }>(
    input.queueName ?? REPORT_QUEUE_NAME,
    async (job: Job<ReportJobIdentity>) => {
      const payload = parseContract(ReportQueuePayloadSchema, job.data)
      const eventPrefix = `report-${payload.bullmqJobId.slice("report-".length)}`
      await recordReportProgress(input.database, {
        ledgerKey: payload.ledgerKey,
        eventId: `${eventPrefix}-progress`,
        runEventId: `${eventPrefix}-run-progress`,
        occurredAt: input.clock.now(),
      })
      await job.updateProgress(50)
      if (
        input.configuration.mode === "test" &&
        input.configuration.controls.takeCrashAfterProgress()
      ) {
        throw new InjectedReportWorkerCrashError()
      }
      if (input.configuration.mode === "test") {
        await input.configuration.controls.beforeCompletion()
      }
      const transition = {
        ledgerKey: payload.ledgerKey,
        reportId: payload.reportId,
        eventId: `${eventPrefix}-completed`,
        runEventId: `${eventPrefix}-run-completed`,
        occurredAt: input.clock.now(),
      } as const
      const completed = await completeReportJob(input.database, transition)
      if (input.configuration.mode === "test" && input.configuration.controls.duplicateDelivery) {
        await completeReportJob(input.database, transition)
      }
      if (input.configuration.mode === "test") {
        await input.configuration.controls.afterCompleted()
      }
      return { reportId: completed.reportId ?? payload.reportId }
    },
    { connection: redisConnection(input.redisUrl), concurrency: 1 },
  )
  return {
    waitUntilReady: async (): Promise<void> => worker.waitUntilReady(),
    close: async (): Promise<void> => worker.close(),
  }
}

export const createReportFixtureWorker = (input: ReportFixtureWorkerInput) =>
  createConfiguredReportFixtureWorker({ ...input, configuration: { mode: "production" } })

export const createReportFixtureTestWorker = (
  input: ReportFixtureWorkerInput & { readonly controls: ReportWorkerTestControls },
) =>
  createConfiguredReportFixtureWorker({
    ...input,
    configuration: { mode: "test", controls: input.controls },
  })
