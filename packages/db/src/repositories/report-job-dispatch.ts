import { ConflictError, parseContract } from "@agentic-chat/contracts"
import { and, asc, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { dispatchIntents } from "../schema/index.js"
import { type ReportJobIdentity, ReportJobIdentitySchema } from "./report-job-records.js"

export type PendingReportDispatch = {
  readonly intentId: string
  readonly payload: ReportJobIdentity
}

export const listPendingReportDispatches = async (
  database: DatabaseClient,
): Promise<readonly PendingReportDispatch[]> => {
  const rows = await database.db
    .select({ intentId: dispatchIntents.id, payload: dispatchIntents.payload })
    .from(dispatchIntents)
    .where(
      and(
        eq(dispatchIntents.status, "pending"),
        eq(dispatchIntents.topic, "report.generate"),
        sql`${dispatchIntents.availableAt} <= now()`,
      ),
    )
    .orderBy(asc(dispatchIntents.createdAt), asc(dispatchIntents.id))
  return rows.map((row) => ({
    intentId: row.intentId,
    payload: parseContract(ReportJobIdentitySchema, row.payload),
  }))
}

export const markReportDispatched = async (
  database: DatabaseClient,
  input: { readonly intentId: string; readonly dispatchedAt: Date },
): Promise<void> => {
  const updated = await database.db
    .update(dispatchIntents)
    .set({
      status: "dispatched",
      attempts: sql`${dispatchIntents.attempts} + 1`,
      dispatchedAt: input.dispatchedAt,
    })
    .where(and(eq(dispatchIntents.id, input.intentId), eq(dispatchIntents.status, "pending")))
    .returning({ id: dispatchIntents.id })
  if (updated[0]) return
  const existing = await database.db
    .select({ status: dispatchIntents.status })
    .from(dispatchIntents)
    .where(eq(dispatchIntents.id, input.intentId))
    .limit(1)
  if (existing[0]?.status !== "dispatched") {
    throw new ConflictError(`report dispatch ${input.intentId}`)
  }
}
