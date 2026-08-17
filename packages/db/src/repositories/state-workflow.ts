import {
  ConflictError,
  LOOP_STEP_BUDGET,
  LoopStepLimitExceededError,
  type SkillSnapshot,
} from "@agentic-chat/contracts"
import { and, asc, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { dispatchIntents, messages, runEvents, runSkillSnapshots, runs } from "../schema/index.js"
import {
  lockStateWorkflowRun,
  nextStateWorkflowSequence,
  type StateWorkflowEventIdentity,
  type StateWorkflowMutationIdentity,
} from "./state-workflow-lock.js"

export const readStateWorkflowRun = async (database: DatabaseClient, runId: string) => {
  const rows = await database.db
    .select({
      runId: runs.id,
      conversationId: runs.conversationId,
      runtime: runs.runtime,
      workflowIdentity: runs.workflowIdentity,
      status: runs.status,
      version: runs.version,
      consumedSteps: runs.consumedSteps,
      continuation: runs.continuation,
      skillId: runSkillSnapshots.skillId,
      skillVersion: runSkillSnapshots.skillVersion,
      instructions: runSkillSnapshots.instructions,
      allowedTools: runSkillSnapshots.allowedTools,
    })
    .from(runs)
    .leftJoin(runSkillSnapshots, eq(runSkillSnapshots.runId, runs.id))
    .where(eq(runs.id, runId))
    .limit(1)
  const userRows = await database.db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.runId, runId), eq(messages.actor, "user")))
    .orderBy(asc(messages.createdAt), asc(messages.id))
  const run = rows[0]
  return run === undefined || userRows[0] === undefined
    ? null
    : {
        ...run,
        userMessage: userRows[0].content,
        userMessages: userRows.map((message) => message.content),
      }
}

export const reconcileStateWorkflowStart = async (
  database: DatabaseClient,
  input: {
    readonly runId: string
    readonly workflowId: string
    readonly intentId: string
    readonly occurredAt: Date
  },
): Promise<void> => {
  await database.db.transaction(async (transaction) => {
    const selected = await transaction
      .select({
        status: dispatchIntents.status,
        topic: dispatchIntents.topic,
        runId: dispatchIntents.aggregateId,
        runtime: runs.runtime,
        workflowIdentity: runs.workflowIdentity,
      })
      .from(dispatchIntents)
      .innerJoin(runs, eq(runs.id, dispatchIntents.aggregateId))
      .where(eq(dispatchIntents.id, input.intentId))
      .for("update")
      .limit(1)
    const intent = selected[0]
    if (
      intent?.topic !== "state_workflow.start" ||
      intent.runId !== input.runId ||
      intent.runtime !== "state_workflow" ||
      intent.workflowIdentity !== input.workflowId
    ) {
      throw new ConflictError(`state workflow start ${input.intentId}`)
    }
    if (intent.status === "dispatched") return
    await transaction
      .update(dispatchIntents)
      .set({
        status: "dispatched",
        attempts: sql`${dispatchIntents.attempts} + 1`,
        dispatchedAt: input.occurredAt,
      })
      .where(eq(dispatchIntents.id, input.intentId))
  })
}

export const consumeStateWorkflowStep = async (
  database: DatabaseClient,
  input: StateWorkflowMutationIdentity &
    StateWorkflowEventIdentity & { readonly context: JsonValue },
): Promise<{ readonly version: number; readonly consumedSteps: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockStateWorkflowRun(transaction, input)
    if (current.consumedSteps >= LOOP_STEP_BUDGET) {
      throw new LoopStepLimitExceededError(LOOP_STEP_BUDGET)
    }
    const consumedSteps = current.consumedSteps + 1
    const updated = await transaction
      .update(runs)
      .set({
        status: "running",
        consumedSteps,
        continuation: input.context,
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.runId))
      .returning({ version: runs.version })
    if (current.status === "queued") {
      await transaction.insert(runEvents).values({
        id: input.eventId,
        runId: input.runId,
        sequence: await nextStateWorkflowSequence(transaction, input.runId),
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "queued", current: "running" },
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      })
    }
    return { version: updated[0]?.version ?? input.expectedVersion + 1, consumedSteps }
  })

export const persistStateWorkflowSkill = async (
  database: DatabaseClient,
  input: StateWorkflowMutationIdentity &
    StateWorkflowEventIdentity & { readonly skill: SkillSnapshot; readonly context: JsonValue },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockStateWorkflowRun(transaction, input)
    await transaction
      .insert(runSkillSnapshots)
      .values({
        runId: input.runId,
        skillId: input.skill.skillId,
        skillVersion: input.skill.version,
        instructions: input.skill.instructions,
        allowedTools: input.skill.allowedTools,
        loadedAt: input.occurredAt,
      })
      .onConflictDoUpdate({
        target: runSkillSnapshots.runId,
        set: {
          skillId: input.skill.skillId,
          skillVersion: input.skill.version,
          instructions: input.skill.instructions,
          allowedTools: input.skill.allowedTools,
          loadedAt: input.occurredAt,
        },
      })
    const updated = await transaction
      .update(runs)
      .set({
        continuation: input.context,
        version: sql`${runs.version} + 1`,
        updatedAt: input.occurredAt,
      })
      .where(eq(runs.id, input.runId))
      .returning({ version: runs.version })
    await transaction.insert(runEvents).values({
      id: input.eventId,
      runId: input.runId,
      sequence: await nextStateWorkflowSequence(transaction, input.runId),
      type: "skill.loaded",
      visibility: "user",
      payload: input.skill,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })
