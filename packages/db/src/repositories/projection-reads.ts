import { and, asc, eq, gt } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { runEvents, runSkillSnapshots, runs } from "../schema/index.js"

export const readRunProjectionRecord = async (database: DatabaseClient, runId: string) => {
  const rows = await database.db
    .select({
      runId: runs.id,
      conversationId: runs.conversationId,
      runtime: runs.runtime,
      status: runs.status,
      version: runs.version,
      consumedSteps: runs.consumedSteps,
      skillId: runSkillSnapshots.skillId,
      skillVersion: runSkillSnapshots.skillVersion,
      instructions: runSkillSnapshots.instructions,
      allowedTools: runSkillSnapshots.allowedTools,
    })
    .from(runs)
    .leftJoin(runSkillSnapshots, eq(runSkillSnapshots.runId, runs.id))
    .where(eq(runs.id, runId))
    .limit(1)
  return rows[0] ?? null
}

export const readRunEventRecords = async (
  database: DatabaseClient,
  input: { readonly runId: string; readonly afterSequence: number },
) =>
  database.db
    .select({
      eventId: runEvents.id,
      runId: runEvents.runId,
      sequence: runEvents.sequence,
      type: runEvents.type,
      visibility: runEvents.visibility,
      payload: runEvents.payload,
      correlationId: runEvents.correlationId,
      occurredAt: runEvents.occurredAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, input.runId), gt(runEvents.sequence, input.afterSequence)))
    .orderBy(asc(runEvents.sequence))
