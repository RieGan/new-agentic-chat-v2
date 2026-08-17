import {
  LOOP_STEP_BUDGET,
  LoopStepLimitExceededError,
  type SkillSnapshot,
} from "@agentic-chat/contracts"
import { and, desc, eq, sql } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import type { JsonValue } from "../schema/index.js"
import { messages, runEvents, runSkillSnapshots, runs } from "../schema/index.js"
import {
  type LeaseIdentity,
  lockSimpleLoopLease,
  nextSimpleLoopSequence,
  type SimpleLoopEventIdentity,
} from "./simple-loop-lock.js"

export const readSimpleLoopRun = async (database: DatabaseClient, runId: string) => {
  const runRows = await database.db
    .select({
      runId: runs.id,
      conversationId: runs.conversationId,
      runtime: runs.runtime,
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
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(1)
  const run = runRows[0]
  return run === undefined || userRows[0] === undefined
    ? null
    : { ...run, userMessage: userRows[0].content }
}

export const consumeSimpleLoopStep = async (
  database: DatabaseClient,
  input: LeaseIdentity & SimpleLoopEventIdentity & { readonly context: JsonValue },
): Promise<{ readonly version: number; readonly consumedSteps: number }> =>
  database.db.transaction(async (transaction) => {
    const current = await lockSimpleLoopLease(transaction, input)
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
        sequence: await nextSimpleLoopSequence(transaction, input.runId),
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "queued", current: "running" },
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
      })
    }
    return { version: updated[0]?.version ?? input.expectedVersion + 1, consumedSteps }
  })

export const persistSimpleLoopSkill = async (
  database: DatabaseClient,
  input: LeaseIdentity &
    SimpleLoopEventIdentity & { readonly skill: SkillSnapshot; readonly context: JsonValue },
): Promise<{ readonly version: number }> =>
  database.db.transaction(async (transaction) => {
    await lockSimpleLoopLease(transaction, input)
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
      sequence: await nextSimpleLoopSequence(transaction, input.runId),
      type: "skill.loaded",
      visibility: "user",
      payload: input.skill,
      correlationId: input.correlationId,
      occurredAt: input.occurredAt,
    })
    return { version: updated[0]?.version ?? input.expectedVersion + 1 }
  })
