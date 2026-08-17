import { ConflictError } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAdmissionService } from "../src/application/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"

describe("durable run admission", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("returns the original receipt when a new-run command is replayed", async () => {
    // Given: a deterministic new-run command.
    const service = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("admit_simple"),
    })
    const command = {
      commandId: "command_admit_simple",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_admit_simple",
        runtime: "simple_loop",
        message: "hello",
        idempotencyKey: "idempotency_admit_simple",
      },
    }

    // When: the command is admitted twice.
    const [first, replay] = await Promise.all([service.admit(command), service.admit(command)])
    const laterReplay = await service.admit(command)

    // Then: both calls return one durable admission receipt and one dispatch intent.
    expect(replay).toEqual(first)
    expect(laterReplay).toEqual(first)
    const persisted = await context.database.pool.query<{
      readonly run_count: string
      readonly message_count: string
      readonly event_count: string
      readonly intent_count: string
    }>(
      `select
        (select count(*) from runs where id = $1) run_count,
        (select count(*) from messages where run_id = $1) message_count,
        (select count(*) from run_events where run_id = $1) event_count,
        (select count(*) from dispatch_intents where aggregate_id = $1) intent_count`,
      [first.runId],
    )
    expect(persisted.rows[0]).toEqual({
      run_count: "1",
      message_count: "1",
      event_count: "1",
      intent_count: "1",
    })
  })

  it("persists deterministic State Workflow identity and start intent", async () => {
    // Given: a State Workflow admission command.
    const service = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("admit_workflow"),
    })

    // When: the command is admitted.
    const receipt = await service.admit({
      commandId: "command_admit_workflow",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_admit_workflow",
        runtime: "state_workflow",
        message: "workflow hello",
        idempotencyKey: "idempotency_admit_workflow",
      },
    })

    // Then: identity and intent refer to the admitted run.
    const stored = await context.database.pool.query<{
      readonly workflow_identity: string
      readonly topic: string
    }>(
      `select r.workflow_identity, d.topic
       from runs r join dispatch_intents d on d.aggregate_id = r.id where r.id = $1`,
      [receipt.runId],
    )
    expect(stored.rows[0]).toEqual({
      workflow_identity: `agent-run/${receipt.runId}`,
      topic: "state_workflow.start",
    })
  })

  it("continues the same waiting run once and rejects stale correlation", async () => {
    // Given: a run waiting for the exact User correlation.
    const service = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("waiting"),
    })
    const admitted = await service.admit({
      commandId: "command_waiting",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_waiting",
        runtime: "simple_loop",
        message: "first",
        idempotencyKey: "idempotency_waiting",
      },
    })
    await context.database.pool.query(
      "update runs set status = 'waiting_for_user', continuation = $2::jsonb where id = $1",
      [admitted.runId, JSON.stringify({ correlationId: "correlation_waiting" })],
    )
    const continuation = {
      commandId: "command_continue",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "continue_run",
        conversationId: "conversation_waiting",
        runId: admitted.runId,
        boundary: "waiting_for_user",
        correlationId: "correlation_waiting",
        message: "continue",
        idempotencyKey: "idempotency_continue",
      },
    }

    // When: the valid continuation is replayed.
    const continued = await service.admit(continuation)
    const replay = await service.admit(continuation)

    // Then: it retains identity, creates one continuation message, and stale input fails typed.
    expect(continued.runId).toBe(admitted.runId)
    expect(replay).toEqual(continued)
    await expect(
      service.admit({
        ...continuation,
        commandId: "command_continue_stale",
        payload: {
          ...continuation.payload,
          correlationId: "correlation_wrong",
          idempotencyKey: "idempotency_continue_stale",
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("rejects malformed actor and runtime before durable writes", async () => {
    // Given: an admission service and malformed external commands.
    const service = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("malformed"),
    })

    // When/Then: actor and runtime parsing fail before a conversation is created.
    await expect(
      service.admit({
        commandId: "command_bad_actor",
        createdAt: "2026-08-16T12:00:00.000Z",
        type: "chat.send_message",
        actorId: "attacker",
        payload: {
          kind: "new_run",
          conversationId: "conversation_malformed_actor",
          runtime: "simple_loop",
          message: "bad",
          idempotencyKey: "idempotency_bad_actor",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
    await expect(
      service.admit({
        commandId: "command_bad_boundary",
        createdAt: "2026-08-16T12:00:00.000Z",
        type: "chat.send_message",
        actorId: "mvp_user",
        payload: {
          kind: "continue_run",
          conversationId: "conversation_malformed_boundary",
          runId: "run_missing",
          boundary: "running",
          correlationId: "correlation_bad_boundary",
          message: "bad",
          idempotencyKey: "idempotency_bad_boundary",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
    await expect(
      service.admit({
        commandId: "command_bad_runtime",
        createdAt: "2026-08-16T12:00:00.000Z",
        type: "chat.send_message",
        actorId: "mvp_user",
        payload: {
          kind: "new_run",
          conversationId: "conversation_malformed_runtime",
          runtime: "fallback_runtime",
          message: "bad",
          idempotencyKey: "idempotency_bad_runtime",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
    const rows = await context.database.pool.query<{ readonly count: string }>(
      "select count(*) from conversations where id like 'conversation_malformed_%'",
    )
    expect(rows.rows[0]?.count).toBe("0")
  })
})
