import { ImmutableRuntimeAssignmentError, StaleVersionError } from "@agentic-chat/contracts"
import { eq, max } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { runEvents, runs } from "../schema/index.js"

export type StateWorkflowMutationIdentity = {
  readonly runId: string
  readonly workflowId: string
  readonly expectedVersion: number
  readonly occurredAt: Date
}

export type StateWorkflowEventIdentity = {
  readonly eventId: string
  readonly correlationId: string
}

export type StateWorkflowTransaction = Parameters<
  Parameters<DatabaseClient["db"]["transaction"]>[0]
>[0]

export const lockStateWorkflowRun = async (
  transaction: StateWorkflowTransaction,
  input: StateWorkflowMutationIdentity,
) => {
  const selected = await transaction
    .select({
      version: runs.version,
      runtime: runs.runtime,
      workflowIdentity: runs.workflowIdentity,
      status: runs.status,
      consumedSteps: runs.consumedSteps,
      conversationId: runs.conversationId,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .for("update")
    .limit(1)
  const current = selected[0]
  if (current?.runtime !== "state_workflow" || current.workflowIdentity !== input.workflowId) {
    throw new ImmutableRuntimeAssignmentError(current?.runtime ?? "missing", "state_workflow")
  }
  if (current.version !== input.expectedVersion) {
    throw new StaleVersionError(input.expectedVersion, current.version)
  }
  return current
}

export const nextStateWorkflowSequence = async (
  transaction: StateWorkflowTransaction,
  runId: string,
): Promise<number> => {
  const selected = await transaction
    .select({ sequence: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
  return (selected[0]?.sequence ?? 0) + 1
}
