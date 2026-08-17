import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { hashApprovedArguments } from "@agentic-chat/tools"
import { createDatabase, migrateDatabase, seedDatabase } from "../src/index.js"

const execute = promisify(execFile)
const approvalArguments = { previewId: "preview_001" } as const
export const APPROVAL_ARGUMENTS_HASH = hashApprovedArguments(approvalArguments)

export type TestDatabase = Awaited<ReturnType<typeof createDatabase>>

export type TestContext = {
  readonly containerName: string
  readonly database: TestDatabase
}

export const startTestContext = async (): Promise<TestContext> => {
  const containerName = `agentic-chat-db-test-${randomUUID()}`
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
      return { containerName, database }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  await execute("docker", ["rm", "--force", "--volumes", containerName])
  throw new Error(`PostgreSQL container ${containerName} did not become healthy`)
}

export const stopTestContext = async (context: TestContext): Promise<void> => {
  await context.database.close()
  await execute("docker", ["rm", "--force", "--volumes", context.containerName])
}

export const migrateAndSeed = async (context: TestContext): Promise<void> => {
  await migrateDatabase(context.database)
  await seedDatabase(context.database)
}

export const insertRunFixture = async (
  context: TestContext,
  runId: string,
  runtime: "simple_loop" | "state_workflow" = "simple_loop",
): Promise<void> => {
  const conversationId = `conversation_${runId}`
  await context.database.pool.query(
    "insert into conversations (id, user_id) values ($1, 'mvp_user')",
    [conversationId],
  )
  await context.database.pool.query(
    "insert into runs (id, conversation_id, user_id, runtime, status) values ($1, $2, 'mvp_user', $3, 'queued')",
    [runId, conversationId, runtime],
  )
}

export const insertApprovalFixture = async (
  context: TestContext,
  identity: { readonly runId: string; readonly callId: string; readonly approvalId: string },
): Promise<void> => {
  await insertRunFixture(context, identity.runId)
  await context.database.pool.query(
    `insert into tool_calls
      (id, run_id, tool_id, tool_version, status, arguments, arguments_hash)
     values ($1, $2, 'notification.send_email', '1', 'approval_required', $3::jsonb, $4)`,
    [identity.callId, identity.runId, JSON.stringify(approvalArguments), APPROVAL_ARGUMENTS_HASH],
  )
  await context.database.pool.query(
    `insert into approval_requests
      (id, run_id, call_id, tool_id, tool_version, arguments, arguments_hash, required_actor_id, status, expires_at)
     values ($1, $2, $3, 'notification.send_email', '1', $4::jsonb, $5, 'mvp_admin', 'pending', now() + interval '1 hour')`,
    [
      identity.approvalId,
      identity.runId,
      identity.callId,
      JSON.stringify(approvalArguments),
      APPROVAL_ARGUMENTS_HASH,
    ],
  )
}
