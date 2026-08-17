import { and, asc, desc, eq } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import {
  approvalActions,
  approvalRequests,
  conversations,
  jobs,
  messages,
  runs,
  skillVersions,
} from "../schema/index.js"

export const readConversationApiProjection = async (
  database: DatabaseClient,
  conversationId: string,
) => {
  const conversationRows = await database.db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, "mvp_user")))
    .limit(1)
  if (!conversationRows[0]) return null
  const [messageRows, runRows] = await Promise.all([
    database.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt), asc(messages.id)),
    database.db
      .select({ runId: runs.id })
      .from(runs)
      .where(eq(runs.conversationId, conversationId))
      .orderBy(asc(runs.createdAt), asc(runs.id)),
  ])
  return { messages: messageRows, runIds: runRows.map((row) => row.runId) }
}

export type RunListFilters = {
  readonly runtime?: "simple_loop" | "state_workflow"
  readonly status?:
    | "queued"
    | "running"
    | "waiting_for_tool"
    | "waiting_for_admin"
    | "waiting_for_user"
    | "completed"
    | "failed"
}

export const listApiRunIds = async (database: DatabaseClient, input: RunListFilters) => {
  const predicates = [eq(runs.userId, "mvp_user")]
  if (input.runtime !== undefined) predicates.push(eq(runs.runtime, input.runtime))
  if (input.status !== undefined) predicates.push(eq(runs.status, input.status))
  return database.db
    .select({ runId: runs.id })
    .from(runs)
    .where(and(...predicates))
    .orderBy(desc(runs.updatedAt), desc(runs.id))
}

export const listApiApprovalRecords = async (database: DatabaseClient, runId?: string) => {
  const rows = await database.db
    .select({ approval: approvalRequests, action: approvalActions })
    .from(approvalRequests)
    .leftJoin(approvalActions, eq(approvalActions.approvalId, approvalRequests.id))
    .where(runId === undefined ? undefined : eq(approvalRequests.runId, runId))
    .orderBy(asc(approvalRequests.createdAt), asc(approvalRequests.id))
  return rows
}

export const readApiApprovalRecord = async (database: DatabaseClient, approvalId: string) => {
  const rows = await database.db
    .select({ approval: approvalRequests, action: approvalActions })
    .from(approvalRequests)
    .leftJoin(approvalActions, eq(approvalActions.approvalId, approvalRequests.id))
    .where(eq(approvalRequests.id, approvalId))
    .limit(1)
  return rows[0] ?? null
}

export const readApiJobRecord = async (database: DatabaseClient, jobId: string) => {
  const rows = await database.db
    .select({ job: jobs })
    .from(jobs)
    .innerJoin(runs, and(eq(runs.id, jobs.runId), eq(runs.userId, "mvp_user")))
    .where(eq(jobs.id, jobId))
    .orderBy(desc(jobs.updatedAt))
    .limit(1)
  return rows[0]?.job ?? null
}

export const readApiSkillRecord = async (
  database: DatabaseClient,
  input: { readonly skillId: string; readonly version: string },
) => {
  const rows = await database.db
    .select()
    .from(skillVersions)
    .where(and(eq(skillVersions.skillId, input.skillId), eq(skillVersions.version, input.version)))
    .limit(1)
  return rows[0] ?? null
}
