import { ConflictError, RunIdSchema, type RunState } from "@agentic-chat/contracts"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"

import type { DatabaseClient } from "../database.js"
import { dispatchIntents, runs } from "../schema/index.js"

type SimpleLoopDispatchAcknowledgement = {
  readonly intentId: string
  readonly runId: string
  readonly dispatchedAt: Date
}

const dispatchPayloadSchema = z.looseObject({ runId: RunIdSchema })

const isDurableRunState = (status: RunState): boolean => {
  switch (status) {
    case "waiting_for_tool":
    case "waiting_for_admin":
    case "waiting_for_user":
    case "completed":
    case "failed":
      return true
    case "queued":
    case "running":
      return false
    default: {
      const exhaustiveStatus: never = status
      return exhaustiveStatus
    }
  }
}

const acknowledge = async (
  database: DatabaseClient,
  input: SimpleLoopDispatchAcknowledgement & {
    readonly evidence: "execution_returned" | "persisted_run"
  },
): Promise<boolean> =>
  database.db.transaction(async (transaction) => {
    const selected = await transaction
      .select({
        status: dispatchIntents.status,
        topic: dispatchIntents.topic,
        aggregateId: dispatchIntents.aggregateId,
        payload: dispatchIntents.payload,
        runtime: runs.runtime,
        runStatus: runs.status,
      })
      .from(dispatchIntents)
      .innerJoin(runs, eq(runs.id, dispatchIntents.aggregateId))
      .where(eq(dispatchIntents.id, input.intentId))
      .for("update")
      .limit(1)
    const intent = selected[0]
    const payload = dispatchPayloadSchema.safeParse(intent?.payload)
    if (
      intent?.topic !== "simple_loop.execute" ||
      intent.aggregateId !== input.runId ||
      intent.runtime !== "simple_loop" ||
      !payload.success ||
      payload.data.runId !== input.runId
    ) {
      throw new ConflictError(`simple loop dispatch ${input.intentId}`)
    }
    if (intent.status === "dispatched") return true
    if (intent.status !== "pending") {
      throw new ConflictError(`simple loop dispatch ${input.intentId}`)
    }
    if (input.evidence === "persisted_run" && !isDurableRunState(intent.runStatus)) return false
    await transaction
      .update(dispatchIntents)
      .set({
        status: "dispatched",
        attempts: sql`${dispatchIntents.attempts} + 1`,
        dispatchedAt: input.dispatchedAt,
      })
      .where(and(eq(dispatchIntents.id, input.intentId), eq(dispatchIntents.status, "pending")))
    return true
  })

export const acknowledgeSimpleLoopDispatch = async (
  database: DatabaseClient,
  input: SimpleLoopDispatchAcknowledgement,
): Promise<void> => {
  await acknowledge(database, { ...input, evidence: "execution_returned" })
}

export const acknowledgeStaleSimpleLoopDispatch = async (
  database: DatabaseClient,
  input: SimpleLoopDispatchAcknowledgement,
): Promise<boolean> => acknowledge(database, { ...input, evidence: "persisted_run" })
