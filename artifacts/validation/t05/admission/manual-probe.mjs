import { createDatabase, migrateDatabase, seedDatabase } from "../../../../packages/db/dist/index.js"
import {
  createAdmissionService,
  createClaimService,
  createProjectionService,
  createReconciliationService,
} from "../../../../packages/runtime/dist/index.js"

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is required")

const database = createDatabase(connectionString)
const clock = { now: () => new Date("2026-08-16T12:00:00.000Z") }
let sequence = 0
const ids = { next: (kind) => `${kind}_manual_${++sequence}` }

try {
  await migrateDatabase(database)
  await seedDatabase(database)
  const admission = createAdmissionService({ database, clock, ids })
  const command = (runtime, suffix) => ({
    commandId: `command_manual_${suffix}`,
    createdAt: "2026-08-16T12:00:00.000Z",
    type: "chat.send_message",
    actorId: "mvp_user",
    payload: {
      kind: "new_run",
      conversationId: `conversation_manual_${suffix}`,
      runtime,
      message: `manual ${suffix}`,
      idempotencyKey: `idempotency_manual_${suffix}`,
    },
  })
  const simpleCommand = command("simple_loop", "simple")
  const simple = await admission.admit(simpleCommand)
  const duplicate = await admission.admit(simpleCommand)
  const workflow = await admission.admit(command("state_workflow", "workflow"))
  const lease = await createClaimService(database).claimNext({
    owner: "worker-manual",
    durationSeconds: 30,
  })
  const workflowStarts = await createReconciliationService(database).listWorkflowStarts()
  await database.pool.query(
    `insert into run_events
      (id, run_id, sequence, type, visibility, payload, correlation_id, occurred_at)
     values ('event_manual_hidden', $1, 2, 'admin.command.accepted', 'model_only',
       '{"commandId":"admin_manual_hostile","status":"accepted"}'::jsonb,
       'correlation_manual_hidden', $2)`,
    [simple.runId, clock.now()],
  )
  const projections = createProjectionService(database)
  const user = await projections.get({ viewer: "user", runId: simple.runId })
  const admin = await projections.get({ viewer: "admin", runId: simple.runId })
  const userCatchup = await projections.events({
    viewer: "user",
    runId: simple.runId,
    afterSequence: 1,
  })
  const adminCatchup = await projections.events({
    viewer: "admin",
    runId: simple.runId,
    afterSequence: 1,
  })
  const userReconnect = await projections.events({
    viewer: "user",
    runId: simple.runId,
    afterSequence: userCatchup.cursor.sequence,
  })
  const persisted = await database.pool.query(
    `select version(),
      (select count(*)::int from runs) run_count,
      (select count(*)::int from dispatch_intents) intent_count`,
  )
  console.log(
    JSON.stringify({
      postgres: persisted.rows[0].version,
      runCount: persisted.rows[0].run_count,
      intentCount: persisted.rows[0].intent_count,
      duplicateReceipt: duplicate.runId === simple.runId,
      simpleClaimed: lease?.runId === simple.runId,
      workflowRunId: workflow.runId,
      workflowStartCount: workflowStarts.length,
      userEventCount: user.events.length,
      adminEventCount: admin.events.length,
      userContainsHidden: user.events.some((event) => event.visibility !== "user"),
      userCatchupEventCount: userCatchup.events.length,
      userCatchupCursor: userCatchup.cursor.sequence,
      adminCatchupEventCount: adminCatchup.events.length,
      userReconnectEventCount: userReconnect.events.length,
      userReconnectCursor: userReconnect.cursor.sequence,
    }),
  )
} finally {
  await database.close()
}
