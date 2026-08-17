import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"

import { createDatabase, migrateDatabase, seedDatabase } from "@agentic-chat/db"

import type { RunEventSource } from "../src/events/source.js"

const execute = promisify(execFile)

export type ApiTestContext = {
  readonly containerName: string
  readonly database: ReturnType<typeof createDatabase>
}

export const startApiTestContext = async (): Promise<ApiTestContext> => {
  const containerName = `agentic-chat-api-test-${randomUUID()}`
  await execute("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--env",
    "POSTGRES_PASSWORD=postgres",
    "--env",
    "POSTGRES_DB=agentic_chat_test",
    "--publish",
    "127.0.0.1::5432",
    "--health-cmd",
    "pg_isready -h 127.0.0.1 -U postgres -d agentic_chat_test",
    "--health-interval",
    "250ms",
    "--health-timeout",
    "2s",
    "--health-retries",
    "80",
    "postgres:17-alpine",
  ])
  const portOutput = await execute("docker", ["port", containerName, "5432/tcp"])
  const port = Number(portOutput.stdout.trim().split(":").at(-1))
  if (!Number.isSafeInteger(port)) {
    throw new TypeError(`Docker returned an invalid PostgreSQL port: ${portOutput.stdout}`)
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const health = await execute("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      containerName,
    ])
    if (health.stdout.trim() === "healthy") {
      const database = createDatabase(
        `postgresql://postgres:postgres@127.0.0.1:${port}/agentic_chat_test`,
      )
      await migrateDatabase(database)
      await seedDatabase(database)
      return { containerName, database }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await execute("docker", ["rm", "--force", "--volumes", containerName])
  throw new Error(`PostgreSQL container ${containerName} did not become healthy`)
}

export const stopApiTestContext = async (context: ApiTestContext): Promise<void> => {
  await context.database.close()
  await execute("docker", ["rm", "--force", "--volumes", context.containerName])
}

export const testClock = { now: (): Date => new Date("2026-08-17T12:00:00.000Z") }

export const createTestIds = (namespace: string) => {
  let sequence = 0
  return {
    next: (kind: string): string => {
      sequence += 1
      return `${kind}_${namespace}_${sequence}`
    },
  }
}

export class ManualRunEventSource implements RunEventSource {
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly drained = new Set<() => void>()
  private registrationHook: (() => Promise<void>) | undefined

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0)
  }

  onNextRegistration(hook: () => Promise<void>): void {
    this.registrationHook = hook
  }

  waitForNoListeners(): Promise<void> {
    if (this.listenerCount === 0) return Promise.resolve()
    return new Promise((resolve) => this.drained.add(resolve))
  }

  async listen(runId: string, listener: () => void): Promise<() => void> {
    const listeners = this.listeners.get(runId) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(runId, listeners)
    const hook = this.registrationHook
    this.registrationHook = undefined
    await hook?.()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(runId)
      if (this.listenerCount === 0) {
        for (const resolve of this.drained) resolve()
        this.drained.clear()
      }
    }
  }

  emit(runId: string): void {
    for (const listener of this.listeners.get(runId) ?? []) listener()
  }
}

type InsertEventInput = {
  readonly runId: string
  readonly sequence: number
  readonly eventId: string
  readonly type: "admin.command.accepted" | "approval.requested" | "message.completed"
  readonly visibility: "admin" | "model_only" | "user"
  readonly payload: Readonly<Record<string, unknown>>
}

export const insertRunEvent = async (
  context: ApiTestContext,
  input: InsertEventInput,
): Promise<void> => {
  await context.database.pool.query(
    `insert into run_events
      (id, run_id, sequence, type, visibility, payload, correlation_id, occurred_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      input.eventId,
      input.runId,
      input.sequence,
      input.type,
      input.visibility,
      JSON.stringify(input.payload),
      `correlation_${input.eventId}`,
      testClock.now(),
    ],
  )
}
