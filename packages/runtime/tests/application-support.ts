import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"

import { createDatabase, migrateDatabase, seedDatabase } from "@agentic-chat/db"

const execute = promisify(execFile)

export type ApplicationTestContext = {
  readonly containerName: string
  readonly database: ReturnType<typeof createDatabase>
}

export const startApplicationTestContext = async (): Promise<ApplicationTestContext> => {
  const containerName = `agentic-chat-runtime-test-${randomUUID()}`
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

export const stopApplicationTestContext = async (
  context: ApplicationTestContext,
): Promise<void> => {
  await context.database.close()
  await execute("docker", ["rm", "--force", "--volumes", context.containerName])
}

export const testClock = { now: (): Date => new Date("2026-08-16T12:00:00.000Z") }

export const createTestIds = (namespace: string) => {
  let sequence = 0
  return {
    next: (kind: string): string => {
      sequence += 1
      return `${kind}_${namespace}_${sequence}`
    },
  }
}
