import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { createDatabase } from "@agentic-chat/db"
import { createToolRegistry } from "@agentic-chat/tools"
import { createTRPCClient, httpLink, httpSubscriptionLink, splitLink } from "@trpc/client"
import { EventSource } from "eventsource"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createDatabaseReadiness,
  startApiApplication,
} from "../src/application.js"
import type { AppRouter } from "../src/router.js"
import { createApiHttpServer } from "../src/server.js"
import { createApiServices } from "../src/services.js"
import {
  type ApiTestContext,
  createTestIds,
  ManualRunEventSource,
  startApiTestContext,
  stopApiTestContext,
  testClock,
} from "./trpc-sse-support.js"

const execute = promisify(execFile)

const listen = async (server: ReturnType<typeof createApiHttpServer>): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new TypeError("Expected TCP address")
  return `http://127.0.0.1:${address.port}`
}

const close = (server: ReturnType<typeof createApiHttpServer>): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  )

describe("Compose API application", () => {
  let context: ApiTestContext

  beforeAll(async () => {
    context = await startApiTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApiTestContext(context)
  })

  const services = (namespace: string) =>
    createApiServices({
      database: context.database,
      clock: testClock,
      ids: createTestIds(namespace),
      tools: createToolRegistry(),
    })

  it("returns application-owned readiness when PostgreSQL is reachable", async () => {
    // Given: the real API server probes its migrated PostgreSQL dependency.
    const server = createApiHttpServer({
      services: services("health_ready"),
      events: new ManualRunEventSource(),
      readiness: createDatabaseReadiness(context.database),
    })
    const baseUrl = await listen(server)

    // When: Compose's canonical readiness route is requested.
    const response = await fetch(`${baseUrl}/healthz`)

    // Then: readiness identifies the application and its database dependency.
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      service: "api",
      status: "ready",
      dependencies: { database: "ready" },
    })
    await close(server)
  })

  it("fails readiness when PostgreSQL is unavailable", async () => {
    // Given: the API database dependency points at an unavailable local endpoint.
    const unavailable = createDatabase("postgresql://postgres:postgres@127.0.0.1:1/unavailable")
    const server = createApiHttpServer({
      services: services("health_unavailable"),
      events: new ManualRunEventSource(),
      readiness: createDatabaseReadiness(unavailable),
    })
    const baseUrl = await listen(server)

    // When: readiness probes the broken dependency.
    const response = await fetch(`${baseUrl}/healthz`)

    // Then: the fixed response is unavailable without leaking connection details.
    expect(response.status).toBe(503)
    const body = await response.text()
    expect(JSON.parse(body)).toEqual({
      service: "api",
      status: "not_ready",
      dependencies: { database: "unavailable" },
    })
    expect(body).not.toContain("postgresql://")
    await close(server)
    await unavailable.close()
  })

  it("routes a real fixed-User tRPC procedure and keeps unknown routes at 404", async () => {
    // Given: a database-backed fixed-User HTTP server.
    const server = createApiHttpServer({
      services: services("routing"),
      events: new ManualRunEventSource(),
      readiness: createDatabaseReadiness(context.database),
    })
    const baseUrl = await listen(server)
    const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${baseUrl}/trpc/user` })] })

    // When: User reads a seeded skill and an unrelated route is requested.
    const skill = await client.skills.get.query({ skillId: "calculator_assistant", version: "1" })
    const unknown = await fetch(`${baseUrl}/unknown`)

    // Then: the typed router responds while non-tRPC behavior remains fail-closed.
    expect(skill).toMatchObject({ skillId: "calculator_assistant", version: "1" })
    expect(unknown.status).toBe(404)
    await expect(unknown.text()).resolves.toBe("Not Found")
    await close(server)
  })

  it("resolves the runtime package to compiled JavaScript under production conditions", async () => {
    // Given: Node resolves workspace packages using the container's production condition.
    const probe = [
      "import('@agentic-chat/runtime')",
      ".then(({ systemClock, secureIds }) => {",
      "  console.log(JSON.stringify({ clock: typeof systemClock.now, ids: typeof secureIds.next }))",
      "})",
    ].join("\n")

    // When: the production package root is imported by Node.
    const result = await execute(process.execPath, ["--conditions=production", "--input-type=module", "--eval", probe], {
      cwd: new URL("..", import.meta.url),
    })

    // Then: production resolution reaches executable compiled exports.
    expect(JSON.parse(result.stdout)).toEqual({ clock: "function", ids: "function" })
  })

  it("closes active SSE and database resources during application shutdown", async () => {
    // Given: a production-shaped application with an active fixed-User subscription.
    const database = createDatabase(context.connectionString)
    const events = new ManualRunEventSource()
    const application = await startApiApplication({
      dependencies: {
        database,
        clock: testClock,
        ids: createTestIds("shutdown"),
        tools: createToolRegistry(),
      },
      events,
      listen: { host: "127.0.0.1", port: 0 },
    })
    const address = application.server.address()
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
    const receipt = await client.chat.sendMessage.mutate({
      kind: "new_run",
      conversationId: "conversation_shutdown",
      runtime: "simple_loop",
      message: "shutdown",
      idempotencyKey: "idempotency_shutdown",
    })
    const subscription = client.runs.events.subscribe({ runId: receipt.runId }, { onData: () => {} })
    await events.waitForListener()

    // When: the application lifecycle shuts down with an SSE connection active.
    await application.shutdown()

    // Then: the stream listener and PostgreSQL pool are both closed.
    await events.waitForNoListeners()
    expect(events.listenerCount).toBe(0)
    await expect(database.pool.query("select 1")).rejects.toThrow()
    subscription.unsubscribe()
  })
})
