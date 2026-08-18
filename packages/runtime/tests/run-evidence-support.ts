import type { ContractErrorData } from "@agentic-chat/contracts"

import type { ApplicationTestContext } from "./application-support.js"

export const readRunEvidence = async (context: ApplicationTestContext, runId: string) => {
  const run = await context.database.pool.query<{
    readonly status: string
    readonly consumed_steps: number
    readonly fencing_version: number
    readonly lease_owner: string | null
    readonly continuation: unknown
  }>(
    "select status, consumed_steps, fencing_version, lease_owner, continuation from runs where id = $1",
    [runId],
  )
  const events = await context.database.pool.query<{
    readonly type: string
    readonly visibility: "user" | "admin" | "model_only" | "internal"
    readonly payload: unknown
  }>("select type, visibility, payload from run_events where run_id = $1 order by sequence", [
    runId,
  ])
  const messages = await context.database.pool.query<{
    readonly actor: string
    readonly content: string
  }>("select actor, content from messages where run_id = $1 order by created_at, id", [runId])
  const calls = await context.database.pool.query<{
    readonly tool_id: string
    readonly status: string
    readonly error: ContractErrorData | null
    readonly result: unknown
  }>(
    "select tool_id, status, error, result from tool_calls where run_id = $1 order by created_at",
    [runId],
  )
  return {
    run: run.rows[0],
    events: events.rows,
    messages: messages.rows,
    calls: calls.rows,
  }
}
