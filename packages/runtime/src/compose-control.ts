import { createDatabase } from "@agentic-chat/db"
import { createToolRegistry } from "@agentic-chat/tools"
import { z } from "zod"

import { createAdmissionService } from "./application/admission.js"
import { createApprovalService } from "./application/approvals.js"
import { systemClock } from "./application/dependencies.js"

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  TASK18_COMPOSE_MODE: z.literal("enabled"),
  NODE_ENV: z.literal("test"),
})
const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("admit"),
    runtime: z.enum(["simple_loop", "state_workflow"]),
    scenario: z.string().min(1),
    flow: z.enum(["report", "approval"]),
  }),
  z.object({ kind: z.literal("approve"), runId: z.string().min(1), scenario: z.string().min(1) }),
  z.object({ kind: z.literal("release_fixture"), scenario: z.string().min(1) }),
  z.object({ kind: z.literal("inspect"), runId: z.string().min(1) }),
])

const parseCommand = (): z.infer<typeof commandSchema> => {
  const [kind, first, second, third] = process.argv.slice(2)
  switch (kind) {
    case "admit":
      return commandSchema.parse({ kind, runtime: first, flow: second, scenario: third })
    case "approve":
      return commandSchema.parse({ kind, runId: first, scenario: second })
    case "release_fixture":
      return commandSchema.parse({ kind, scenario: first })
    case "inspect":
      return commandSchema.parse({ kind, runId: first })
    default:
      return commandSchema.parse({ kind })
  }
}

const createIds = (scenario: string) => {
  let sequence = 0
  return { next: (type: string): string => `${type}_${scenario}_${++sequence}` }
}

const inspectRun = async (database: ReturnType<typeof createDatabase>, runId: string) => {
  const [run, events, calls, jobs, approvals, messages, sends, intents] = await Promise.all([
    database.pool.query("select * from runs where id = $1", [runId]),
    database.pool.query("select * from run_events where run_id = $1 order by sequence", [runId]),
    database.pool.query("select * from tool_calls where run_id = $1 order by created_at, id", [
      runId,
    ]),
    database.pool.query("select * from jobs where run_id = $1 order by created_at, id", [runId]),
    database.pool.query(
      "select * from approval_requests where run_id = $1 order by created_at, id",
      [runId],
    ),
    database.pool.query("select * from messages where run_id = $1 order by created_at, id", [
      runId,
    ]),
    database.pool.query(
      "select * from simulated_sends where call_id in (select id from tool_calls where run_id = $1)",
      [runId],
    ),
    database.pool.query(
      "select * from dispatch_intents where aggregate_id = $1 or payload ->> 'runId' = $1 order by created_at, id",
      [runId],
    ),
  ])
  return {
    run: run.rows[0] ?? null,
    events: events.rows,
    calls: calls.rows,
    jobs: jobs.rows,
    approvals: approvals.rows,
    messages: messages.rows,
    sends: sends.rows,
    intents: intents.rows,
  }
}

const environment = environmentSchema.parse(process.env)
const command = parseCommand()
const database = createDatabase(environment.DATABASE_URL)
try {
  switch (command.kind) {
    case "admit": {
      if (command.flow === "report") {
        await database.pool.query(
          `insert into dispatch_intents
            (id, aggregate_type, aggregate_id, deduplication_key, topic, payload)
           values ($1, 'task18', $2, $3, 'task18.fixture.hold', $4::jsonb)`,
          [
            `task18_hold_${command.scenario}`,
            command.scenario,
            `task18:hold:${command.scenario}`,
            JSON.stringify({ scenario: command.scenario }),
          ],
        )
      }
      const receipt = await createAdmissionService({
        database,
        clock: systemClock,
        ids: createIds(command.scenario),
      }).admit({
        commandId: `command_${command.scenario}`,
        createdAt: systemClock.now().toISOString(),
        type: "chat.send_message",
        actorId: "mvp_user",
        payload: {
          kind: "new_run",
          conversationId: `conversation_${command.scenario}`,
          runtime: command.runtime,
          message: `TASK18 ${command.flow} ${command.scenario}`,
          idempotencyKey: `idempotency_${command.scenario}`,
        },
      })
      console.log(JSON.stringify({ command, receipt }))
      break
    }
    case "approve": {
      const selected = await database.pool.query<{
        readonly id: string
        readonly call_id: string
        readonly arguments_hash: string
        readonly version: number
      }>(
        "select id, call_id, arguments_hash, version from approval_requests where run_id = $1 and status = 'pending'",
        [command.runId],
      )
      const approval = selected.rows[0]
      if (!approval) throw new TypeError("Pending approval not found")
      const result = await createApprovalService({
        database,
        clock: systemClock,
        ids: createIds(`${command.scenario}_decision`),
        tools: createToolRegistry(),
      }).decide(
        { actorId: "mvp_admin" },
        {
          decision: "approve",
          approvalId: approval.id,
          callId: approval.call_id,
          expectedArgumentsHash: approval.arguments_hash,
          expectedVersion: approval.version,
        },
      )
      console.log(JSON.stringify({ command, result }))
      break
    }
    case "release_fixture": {
      const released = await database.pool.query(
        "update dispatch_intents set status = 'dispatched', dispatched_at = now() where id = $1 and status = 'pending' returning id",
        [`task18_hold_${command.scenario}`],
      )
      if (released.rowCount !== 1) throw new TypeError("Fixture hold was not pending")
      console.log(JSON.stringify({ command, released: released.rows[0] }))
      break
    }
    case "inspect":
      console.log(JSON.stringify(await inspectRun(database, command.runId)))
      break
    default: {
      const exhaustiveCommand: never = command
      throw new TypeError(`Unsupported command ${JSON.stringify(exhaustiveCommand)}`)
    }
  }
} finally {
  await database.close()
}
