import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAdmissionService, createProjectionService } from "../src/application/index.js"
import {
  type ApplicationTestContext,
  createOwnedConversation,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"

describe("viewer-aware event catch-up", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  const admitWithHiddenEvent = async (namespace: string) => {
    await createOwnedConversation(context, `conversation_${namespace}`)
    const receipt = await createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds(namespace),
    }).admit({
      commandId: `command_${namespace}`,
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: `conversation_${namespace}`,
        runtime: "simple_loop",
        message: "visible one",
        idempotencyKey: `idempotency_${namespace}`,
      },
    })
    await context.database.pool.query(
      `insert into run_events
        (id, run_id, sequence, type, visibility, payload, correlation_id, occurred_at)
       values ($1, $2, 2, 'admin.command.accepted', 'model_only', $3::jsonb, $4, $5)`,
      [
        `event_hidden_${namespace}`,
        receipt.runId,
        JSON.stringify({ commandId: `admin_${namespace}`, status: "accepted" }),
        `correlation_hidden_${namespace}`,
        testClock.now(),
      ],
    )
    return receipt
  }

  it("excludes hidden events from User catch-up while advancing the inspected cursor", async () => {
    // Given: a run whose next canonical event is model-only.
    const receipt = await admitWithHiddenEvent("user_catchup")

    // When: the User catches up after the first visible event.
    const result = await createProjectionService(context.database).events({
      viewer: "user",
      runId: receipt.runId,
      afterSequence: 1,
    })

    // Then: no hidden event is returned, but the cursor advances past it.
    expect(result.events).toEqual([])
    expect(result.cursor.sequence).toBe(2)
  })

  it("retains hidden events for Admin catch-up", async () => {
    // Given: a run whose next canonical event is model-only.
    const receipt = await admitWithHiddenEvent("admin_catchup")

    // When: the Admin catches up after the first visible event.
    const result = await createProjectionService(context.database).events({
      viewer: "admin",
      runId: receipt.runId,
      afterSequence: 1,
    })

    // Then: the hidden event remains available as inert canonical data.
    expect(result.events.map((event) => event.sequence)).toEqual([2])
    expect(result.events[0]?.visibility).toBe("model_only")
    expect(result.cursor.sequence).toBe(2)
  })

  it("reconnects from the inspected cursor without hidden-event loops or visible duplicates", async () => {
    // Given: a User cursor advanced over one hidden event.
    const receipt = await admitWithHiddenEvent("reconnect")
    const projections = createProjectionService(context.database)
    const first = await projections.events({
      viewer: "user",
      runId: receipt.runId,
      afterSequence: 1,
    })

    // When: reconnect repeats, then a new visible event arrives and reconnect repeats again.
    const hiddenReplay = await projections.events({
      viewer: "user",
      runId: receipt.runId,
      afterSequence: first.cursor.sequence,
    })
    await context.database.pool.query(
      `insert into run_events
        (id, run_id, sequence, type, visibility, payload, correlation_id, occurred_at)
       values ($1, $2, 3, 'message.completed', 'user', $3::jsonb, $4, $5)`,
      [
        "event_visible_reconnect",
        receipt.runId,
        JSON.stringify({
          messageId: "message_visible_reconnect",
          actor: "ai",
          content: "visible three",
        }),
        "correlation_visible_reconnect",
        testClock.now(),
      ],
    )
    const visible = await projections.events({
      viewer: "user",
      runId: receipt.runId,
      afterSequence: hiddenReplay.cursor.sequence,
    })
    const visibleReplay = await projections.events({
      viewer: "user",
      runId: receipt.runId,
      afterSequence: visible.cursor.sequence,
    })

    // Then: hidden and visible events are each inspected once, with no replayed output.
    expect(hiddenReplay.events).toEqual([])
    expect(hiddenReplay.cursor.sequence).toBe(2)
    expect(visible.events.map((event) => event.sequence)).toEqual([3])
    expect(visibleReplay.events).toEqual([])
    expect(visibleReplay.cursor.sequence).toBe(3)
  })
})
