import { ChatSendMessageInputSchema } from "@agentic-chat/contracts"
import { createToolRegistry } from "@agentic-chat/tools"
import {
  createTRPCClient,
  httpLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from "@trpc/client"
import { EventSource } from "eventsource"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AppRouter } from "../src/router.js"
import { createApiHttpServer } from "../src/server.js"
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

describe("tRPC HTTP and SSE transport", () => {
  let context: ApiTestContext

  beforeAll(async () => {
    context = await startApiTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApiTestContext(context)
  })

  it("streams one persisted event over real SSE and rejects Admin-as-User", async () => {
    // Given: a real dual fixed-actor HTTP server and an admitted User run.
    const events = new ManualRunEventSource()
    const services = createApiServices({
      database: context.database,
      clock: testClock,
      ids: createTestIds("http_sse"),
      tools: createToolRegistry(),
    })
    const server = createApiHttpServer({ services, events, readiness: async () => true })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new TypeError("Expected TCP address")
    const baseUrl = `http://127.0.0.1:${address.port}/trpc/user`
    const client = createTRPCClient<AppRouter>({
      links: [
        splitLink({
          condition: (operation) => operation.type === "subscription",
          true: httpSubscriptionLink({ url: baseUrl, EventSource }),
          false: httpLink({ url: baseUrl }),
        }),
      ],
    })
    await client.conversations.create.mutate({ conversationId: "conversation_http_sse" })
    const receipt = await client.chat.sendMessage.mutate({
      kind: "new_run",
      conversationId: "conversation_http_sse",
      runtime: "simple_loop",
      message: "one",
      idempotencyKey: "idempotency_http_sse",
    })

    // When: SSE starts, sequence two commits, and User attempts an Admin mutation.
    const received = new Promise<number>((resolve, reject) => {
      const subscription = client.runs.events.subscribe(
        { runId: receipt.runId, cursor: { runId: receipt.runId, sequence: 1 } },
        {
          onStarted: async () => {
            await insertRunEvent(context, {
              runId: receipt.runId,
              sequence: 2,
              eventId: "event_http_sse_live",
              type: "message.completed",
              visibility: "user",
              payload: { messageId: "message_http_sse_live", actor: "ai", content: "two" },
            })
            events.emit(receipt.runId)
          },
          onData: (event) => {
            subscription.unsubscribe()
            resolve(event.data.sequence)
          },
          onError: reject,
        },
      )
    })
    const denied = client.admin.command.sendHidden.mutate({
      conversationId: "conversation_http_sse",
      instruction: "HTTP_SECRET",
      expiresAt: "2026-08-17T12:05:00.000Z",
      idempotencyKey: "idempotency_http_admin_denied",
    })
    const deniedStatus = expect(denied).rejects.toBeInstanceOf(TRPCClientError)
    const deniedRedaction = denied.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain("HTTP_SECRET")
    })

    // Then: the SSE frame is discrete and the forbidden transport error is redacted.
    await expect(received).resolves.toBe(2)
    await deniedStatus
    await deniedRedaction
    await events.waitForNoListeners()
    expect(events.listenerCount).toBe(0)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })

  it("returns the typed canonical-refetch signal for an invalid SSE cursor", async () => {
    // Given: a real User SSE endpoint and a cursor beyond canonical persistence.
    const events = new ManualRunEventSource()
    const services = createApiServices({
      database: context.database,
      clock: testClock,
      ids: createTestIds("http_stale"),
      tools: createToolRegistry(),
    })
    const server = createApiHttpServer({ services, events, readiness: async () => true })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (address === null || typeof address === "string") throw new TypeError("Expected TCP address")
    const client = createTRPCClient<AppRouter>({
      links: [
        httpSubscriptionLink({
          url: `http://127.0.0.1:${address.port}/trpc/user`,
          EventSource,
        }),
      ],
    })
    await services.createConversation({ conversationId: "conversation_http_stale" })
    const receipt = await services.sendMessage(
      ChatSendMessageInputSchema.parse({
        kind: "new_run",
        conversationId: "conversation_http_stale",
        runtime: "simple_loop",
        message: "one",
        idempotencyKey: "idempotency_http_stale",
      }),
    )
    const stale = Buffer.from(
      JSON.stringify({ runId: receipt.runId, sequence: 99, eventId: "event_missing" }),
    ).toString("base64url")

    // When: the client opens the subscription from invalid canonical state.
    const refetch = new Promise<string | undefined>((resolve, reject) => {
      client.runs.events.subscribe(
        { runId: receipt.runId, lastEventId: stale },
        {
          onData: () => reject(new TypeError("Invalid cursor produced an event")),
          onError: (error) => resolve(error.data?.refetch),
        },
      )
    })

    // Then: the transport instructs the client to refetch its canonical snapshot.
    await expect(refetch).resolves.toBe("canonical_snapshot")
    await events.waitForNoListeners()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
})
