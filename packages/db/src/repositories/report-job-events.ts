import { CallIdSchema, JobIdSchema, parseContract, ReportIdSchema } from "@agentic-chat/contracts"
import { and, asc, eq } from "drizzle-orm"
import { z } from "zod"

import type { DatabaseClient } from "../database.js"
import { jobEvents, jobs } from "../schema/index.js"

const identity = { jobId: JobIdSchema, callId: CallIdSchema } as const
const ReportJobEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      sequence: z.literal(1),
      type: z.literal("job.accepted"),
      payload: z.object({ ...identity, status: z.literal("queued") }).strict(),
      occurredAt: z.date(),
    })
    .strict(),
  z
    .object({
      sequence: z.literal(2),
      type: z.literal("job.progress"),
      payload: z
        .object({ ...identity, status: z.literal("running"), percent: z.literal(50) })
        .strict(),
      occurredAt: z.date(),
    })
    .strict(),
  z
    .object({
      sequence: z.literal(3),
      type: z.literal("job.completed"),
      payload: z
        .object({ ...identity, status: z.literal("completed"), reportId: ReportIdSchema })
        .strict(),
      occurredAt: z.date(),
    })
    .strict(),
])

export type ReportJobEvent = z.output<typeof ReportJobEventSchema>

export const listReportJobEvents = async (
  database: DatabaseClient,
  scope: { readonly namespace: string; readonly runId: string; readonly jobId: string },
): Promise<readonly ReportJobEvent[]> => {
  const rows = await database.db
    .select({
      sequence: jobEvents.sequence,
      type: jobEvents.type,
      payload: jobEvents.payload,
      occurredAt: jobEvents.occurredAt,
    })
    .from(jobEvents)
    .innerJoin(jobs, eq(jobs.ledgerKey, jobEvents.jobKey))
    .where(
      and(
        eq(jobs.namespace, scope.namespace),
        eq(jobs.runId, scope.runId),
        eq(jobs.id, scope.jobId),
      ),
    )
    .orderBy(asc(jobEvents.sequence))
  return rows.map((row) => parseContract(ReportJobEventSchema, row))
}
