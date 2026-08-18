import { MessageIdSchema } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { admitContinuation, createConversation } from "../src/index.js"
import { migrateAndSeed, startTestContext, stopTestContext, type TestContext } from "./support.js"

const initialTime = new Date("2026-08-16T12:00:00.000Z")

describe("conversation integrity", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
    await migrateAndSeed(context)
  }, 120_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("refreshes conversation recency when a user continuation is admitted", async () => {
    // Given: an older conversation with a run waiting for a matching continuation.
    await createConversation(context.database, {
      conversationId: "conversation_continuation_recency",
      userId: "mvp_user",
      now: initialTime,
    })
    await context.database.pool.query(
      `insert into runs
        (id, conversation_id, user_id, runtime, status, continuation, created_at, updated_at)
       values
        ('run_continuation_recency', 'conversation_continuation_recency', 'mvp_user',
         'simple_loop', 'waiting_for_user',
         '{"wait":{"kind":"user","correlationId":"correlation_continuation_recency"}}'::jsonb,
         $1, $1)`,
      [initialTime],
    )
    const continuedAt = new Date("2026-08-16T12:05:00.000Z")

    // When: the continuation is admitted.
    await admitContinuation(context.database, {
      key: "continuation-recency",
      requestHash: "sha256:continuation-recency",
      receipt: {
        commandId: "command_continuation_recency",
        status: "accepted",
        runId: "run_continuation_recency",
      },
      messageId: MessageIdSchema.parse("message_continuation_recency"),
      eventId: "event_continuation_recency",
      dispatchId: "dispatch_continuation_recency",
      occurredAt: continuedAt,
      conversationId: "conversation_continuation_recency",
      correlationId: "correlation_continuation_recency",
      message: "continue",
    })

    // Then: session ordering observes the continuation time.
    const rows = await context.database.pool.query<{ readonly updated_at: Date }>(
      "select updated_at from conversations where id = 'conversation_continuation_recency'",
    )
    expect(rows.rows[0]?.updated_at).toEqual(continuedAt)
  })

  it("rejects an applied command attributed to a run from another conversation", async () => {
    // Given: two conversations and a run owned by only the second conversation.
    await context.database.pool.query(
      `insert into conversations (id, user_id)
       values
         ('conversation_command_owner', 'mvp_user'),
         ('conversation_run_owner', 'mvp_user');
       insert into runs (id, conversation_id, user_id, runtime, status)
       values ('run_other_conversation', 'conversation_run_owner', 'mvp_user', 'simple_loop', 'running')`,
    )

    // When: persistence attributes the first conversation's command to that foreign run.
    const insert = context.database.pool.query(
      `insert into admin_commands
        (id, conversation_id, applied_run_id, boundary_key, actor_id, instruction, visibility,
         status, idempotency_key, expires_at, applied_at)
       values
        ('command_cross_conversation', 'conversation_command_owner', 'run_other_conversation',
         'boundary_cross_conversation', 'mvp_admin', 'invalid attribution', 'model_only',
         'applied', 'idempotency_cross_conversation', now() + interval '1 hour', now())`,
    )

    // Then: PostgreSQL rejects the mismatched composite ownership.
    await expect(insert).rejects.toMatchObject({ code: "23503" })
  })
})
