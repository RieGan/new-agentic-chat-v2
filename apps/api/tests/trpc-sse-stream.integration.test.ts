import { CanonicalEventSchema, FIXED_ACTORS } from "@agentic-chat/contracts"
import { createToolRegistry } from "@agentic-chat/tools"
import { isTrackedEnvelope } from "@trpc/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApiContext } from "../src/context.js"
import { decodeTrackedCursor } from "../src/events/cursor.js"
import { appRouter } from "../src/router.js"
import { createApiServices } from "../src/services.js"
import {
  type ApiTestContext,
  createTestIds,
  insertRunEvent,
  ManualRunEventSource,
  startApiTestContext,
  stopApiTestContext,
  testClock,
} from "./trpc-sse-support.js"

describe("tracked tRPC SSE", () => {
  let context: ApiTestContext

  beforeAll(async () => {
    context = await startApiTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApiTestContext(context)
  })

  const fixture = async (namespace: string) => {
    const events = new ManualRunEventSource()
    const services = createApiServices({
      database: context.database,
      clock: testClock,
      ids: createTestIds(namespace),
      tools: createToolRegistry(),
    })
    const user = appRouter.createCaller(createApiContext(FIXED_ACTORS.USER, services, events))
    const admin = appRouter.createCaller(createApiContext(FIXED_ACTORS.ADMIN, services, events))
    await user.conversations.create({ conversationId: `conversation_${namespace}` })
    const receipt = await user.chat.sendMessage({
      kind: "new_run",
      conversationId: `conversation_${namespace}`,
      runtime: "simple_loop",
      message: "one",
      idempotencyKey: `idempotency_${namespace}`,
    })
    return { admin, events, receipt, services, user }
  }

  it("registers live before catch-up and suppresses the overlap duplicate", async () => {
    // Given: a commit occurs immediately after listener registration.
    const { events, receipt, user } = await fixture("registration_race")
    events.onNextRegistration(async () => {
      await insertRunEvent(context, {
        runId: receipt.runId,
        sequence: 2,
        eventId: "event_registration_race_2",
        type: "message.completed",
        visibility: "user",
        payload: {
          messageId: "message_registration_race_2",
          actor: "ai",
          content: "two",
        },
      })
      events.emit(receipt.runId)
    })

    // When: the subscription catches up across the registration overlap.
    const stream = await user.runs.events({ runId: receipt.runId })
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    const second = await iterator.next()
    const thirdPending = iterator.next()
    await insertRunEvent(context, {
      runId: receipt.runId,
      sequence: 3,
      eventId: "event_registration_race_live_3",
      type: "message.completed",
      visibility: "user",
      payload: {
        messageId: "message_registration_race_3",
        actor: "ai",
        content: "three",
      },
    })
    events.emit(receipt.runId)
    const third = await thirdPending
    await iterator.return?.()

    // Then: each committed event appears exactly once and cleanup removes the listener.
    expect(first.done).toBe(false)
    expect(second.done).toBe(false)
    expect(
      isTrackedEnvelope(first.value) ? CanonicalEventSchema.parse(first.value[1]).sequence : null,
    ).toBe(1)
    expect(
      isTrackedEnvelope(second.value) ? CanonicalEventSchema.parse(second.value[1]).sequence : null,
    ).toBe(2)
    expect(
      isTrackedEnvelope(third.value) ? CanonicalEventSchema.parse(third.value[1]).sequence : null,
    ).toBe(3)
    expect(events.listenerCount).toBe(0)
  })

  it("filters hidden tails before yield and resumes from the canonical tracked cursor", async () => {
    // Given: a hidden event followed by a visible committed event.
    const { events, receipt, user } = await fixture("hidden_tail")
    const stream = await user.runs.events({
      runId: receipt.runId,
      cursor: { runId: receipt.runId, sequence: 1 },
    })
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()
    await insertRunEvent(context, {
      runId: receipt.runId,
      sequence: 2,
      eventId: "event_hidden_tail_hidden",
      type: "admin.command.accepted",
      visibility: "model_only",
      payload: { commandId: "admin_hidden_tail", status: "accepted" },
    })
    await insertRunEvent(context, {
      runId: receipt.runId,
      sequence: 3,
      eventId: "event_hidden_tail_visible",
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_hidden_tail", actor: "ai", content: "visible" },
    })

    // When: one live signal inspects both canonical sequences.
    events.emit(receipt.runId)
    const visible = await pending
    await iterator.return?.()
    if (!isTrackedEnvelope(visible.value)) throw new TypeError("Expected tracked event")
    const cursor = decodeTrackedCursor(visible.value[0])
    const visibleEvent = CanonicalEventSchema.parse(visible.value[1])

    // Then: only the visible event is yielded and its cursor has advanced over the hidden tail.
    expect(visibleEvent.sequence).toBe(3)
    expect(cursor.sequence).toBe(3)
    expect(JSON.stringify(visible.value)).not.toContain("admin_hidden_tail")
  })

  it("reconnects around a committed event with no gap or duplicate", async () => {
    // Given: the first connection received canonical sequence one.
    const { events, receipt, user } = await fixture("reconnect")
    const firstStream = await user.runs.events({ runId: receipt.runId })
    const firstIterator = firstStream[Symbol.asyncIterator]()
    const first = await firstIterator.next()
    await firstIterator.return?.()
    if (!isTrackedEnvelope(first.value)) throw new TypeError("Expected tracked event")

    // When: sequence two commits before reconnect catch-up.
    await insertRunEvent(context, {
      runId: receipt.runId,
      sequence: 2,
      eventId: "event_reconnect_2",
      type: "message.completed",
      visibility: "user",
      payload: { messageId: "message_reconnect_2", actor: "ai", content: "two" },
    })
    const secondStream = await user.runs.events({
      runId: receipt.runId,
      lastEventId: first.value[0],
    })
    const secondIterator = secondStream[Symbol.asyncIterator]()
    const second = await secondIterator.next()
    await secondIterator.return?.()

    // Then: reconnect yields only sequence two.
    expect(
      isTrackedEnvelope(second.value) ? CanonicalEventSchema.parse(second.value[1]).sequence : null,
    ).toBe(2)
    expect(events.listenerCount).toBe(0)
  })

  it("signals canonical refetch for stale cursors and denies approval stream to User", async () => {
    // Given: a fixed User connection with a non-canonical tracked cursor.
    const { receipt, user } = await fixture("stale_cursor")
    const stale = Buffer.from(
      JSON.stringify({ runId: receipt.runId, sequence: 99, eventId: "event_missing" }),
    ).toString("base64url")

    // When: User reconnects from stale state and invokes the Admin approval stream.
    const stream = await user.runs.events({ runId: receipt.runId, lastEventId: stale })
    const staleResult = stream[Symbol.asyncIterator]().next()

    // Then: transport semantics require canonical refetch and Admin stream remains forbidden.
    await expect(user.approvals.subscribe({ runId: receipt.runId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await expect(staleResult).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Canonical snapshot refetch required",
    })
  })

  it("emits only persisted approval events on the Admin approval subscription", async () => {
    // Given: an Admin approval stream positioned after the initial User event.
    const { admin, events, receipt } = await fixture("approval_stream")
    const stream = await admin.approvals.subscribe({
      runId: receipt.runId,
      cursor: { runId: receipt.runId, sequence: 1 },
    })
    const iterator = stream[Symbol.asyncIterator]()
    const pending = iterator.next()

    // When: one canonical approval request is committed and signaled.
    await insertRunEvent(context, {
      runId: receipt.runId,
      sequence: 2,
      eventId: "event_approval_stream_requested",
      type: "approval.requested",
      visibility: "admin",
      payload: {
        approvalId: "approval_stream",
        callId: "call_approval_stream",
        toolName: "notification.send_email",
        argumentsHash: "hash_approval_stream",
        expiresAt: "2026-08-17T12:05:00.000Z",
      },
    })
    events.emit(receipt.runId)
    const result = await pending
    await iterator.return?.()

    // Then: the tracked Admin frame contains exactly the persisted approval event.
    expect(
      isTrackedEnvelope(result.value) ? CanonicalEventSchema.parse(result.value[1]).type : null,
    ).toBe("approval.requested")
    expect(events.listenerCount).toBe(0)
  })

  it("emits only discrete persisted event types", async () => {
    // Given: a persisted run projection.
    const { receipt, services } = await fixture("discrete_only")

    // When: the User reads all persisted events through catch-up.
    const result = await services.events("user", { runId: receipt.runId })

    // Then: no delta or token-stream event exists on the transport.
    expect(result.events.map((event) => event.type)).toEqual(["message.completed"])
    expect(JSON.stringify(result)).not.toContain("message.delta")
  })
})
