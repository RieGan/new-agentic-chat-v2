import { hashApprovedArguments } from "@agentic-chat/tools"

import type { ApplicationTestContext } from "./application-support.js"

export type ControlFixture = {
  readonly conversationId: string
  readonly runId: string
  readonly callId: string
  readonly arguments: { readonly previewId: string }
  readonly argumentsHash: string
}

export const insertControlFixture = async (
  context: ApplicationTestContext,
  namespace: string,
  status: "running" | "completed" = "running",
): Promise<ControlFixture> => {
  const runId = `run_${namespace}`
  const callId = `call_${namespace}`
  const conversationId = `conversation_${namespace}`
  const arguments_ = { previewId: `preview_${namespace}` }
  const argumentsHash = hashApprovedArguments(arguments_)
  await context.database.pool.query(
    "insert into conversations (id, user_id) values ($1, 'mvp_user')",
    [conversationId],
  )
  await context.database.pool.query(
    "insert into runs (id, conversation_id, user_id, runtime, status) values ($1, $2, 'mvp_user', 'simple_loop', $3)",
    [runId, conversationId, status],
  )
  await context.database.pool.query(
    `insert into run_skill_snapshots
      (run_id, skill_id, skill_version, instructions, allowed_tools)
     select $1, skill_id, version, instructions, allowed_tools
     from skill_versions where skill_id = 'communication_assistant' and version = '1'`,
    [runId],
  )
  await context.database.pool.query(
    `insert into tool_calls
      (id, run_id, tool_id, tool_version, status, arguments, arguments_hash)
     values ($1, $2, 'notification.send_email', '1', 'prepared', $3::jsonb, $4)`,
    [callId, runId, JSON.stringify(arguments_), argumentsHash],
  )
  return { conversationId, runId, callId, arguments: arguments_, argumentsHash }
}
