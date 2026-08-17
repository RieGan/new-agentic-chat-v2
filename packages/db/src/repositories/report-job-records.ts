import {
  CallIdSchema,
  JobIdSchema,
  parseContract,
  ReportIdSchema,
  RunIdSchema,
} from "@agentic-chat/contracts"
import { z } from "zod"

import type { jobs } from "../schema/index.js"

export const ReportJobIdentitySchema = z
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

const ReportJobSnapshotSchema = z
  .object({
    identity: ReportJobIdentitySchema,
    status: z.enum(["queued", "running", "completed", "failed"]),
    percent: z.number().int().min(0).max(100),
    reportId: ReportIdSchema.optional(),
    version: z.number().int().nonnegative(),
  })
  .strict()

export const ReportToolResultSchema = z
  .object({
    toolName: z.literal("report.generate"),
    jobId: JobIdSchema,
    reportId: ReportIdSchema,
    status: z.literal("completed"),
  })
  .strict()

export type ReportJobIdentity = {
  readonly namespace: string
  readonly ledgerKey: string
  readonly runId: string
  readonly callId: string
  readonly jobId: string
  readonly reportId: string
  readonly bullmqJobId: string
}

export type AdmitReportJobInput = ReportJobIdentity & {
  readonly arguments: {
    readonly topic: string
    readonly sections: readonly string[]
  }
  readonly argumentsHash: string
  readonly acceptedEventId: string
  readonly runEventId: string
  readonly dispatchId: string
  readonly occurredAt: Date
}

export type ReportJobSnapshot = z.output<typeof ReportJobSnapshotSchema>

export const toReportJobSnapshot = (row: typeof jobs.$inferSelect): ReportJobSnapshot => {
  const result = row.result === null ? undefined : parseContract(ReportToolResultSchema, row.result)
  return parseContract(ReportJobSnapshotSchema, {
    identity: {
      namespace: row.namespace,
      ledgerKey: row.ledgerKey,
      runId: row.runId,
      callId: row.callId,
      jobId: row.id,
      reportId: result?.reportId ?? "report_001",
      bullmqJobId: row.bullmqJobId,
    },
    status: row.status,
    percent: row.percent,
    ...(result ? { reportId: result.reportId } : {}),
    version: row.version,
  })
}
