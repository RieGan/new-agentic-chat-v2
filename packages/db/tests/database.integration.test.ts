import { ImmutableRuntimeAssignmentError, StaleVersionError } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  migrateDatabase,
  persistRunTransition,
  reserveIdempotency,
  schemaTableNames,
  seedDatabase,
} from "../src/index.js"
import {
  insertRunFixture,
  migrateAndSeed,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "./support.js"

describe("PostgreSQL persistence", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("applies reviewed migrations once when migrate is rerun", async () => {
    // Given: a real empty PostgreSQL database.
    const version = await context.database.pool.query<{ readonly version: string }>(
      "select version()",
    )

    // When: the reviewed migration is applied twice.
    await migrateDatabase(context.database)
    await migrateDatabase(context.database)

    // Then: every Drizzle table exists and all reviewed migrations are recorded.
    expect(version.rows[0]?.version).toContain("PostgreSQL 17")
    const tables = await context.database.pool.query<{ readonly table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )
    const names = tables.rows.map((row) => row.table_name)
    expect(names).toEqual(expect.arrayContaining([...schemaTableNames]))
    const migrationCount = await context.database.pool.query<{ readonly count: string }>(
      'select count(*) from drizzle."__drizzle_migrations"',
    )
    expect(migrationCount.rows[0]?.count).toBe("5")
  })

  it("seeds exactly the MVP actors, skills, and registry tools", async () => {
    // Given: migrated PostgreSQL.
    await seedDatabase(context.database)

    // When: registry records are queried.
    const users = await context.database.pool.query<{ readonly id: string }>(
      "select id from users order by id",
    )
    const skills = await context.database.pool.query<{ readonly id: string }>(
      "select id from skills order by id",
    )
    const tools = await context.database.pool.query<{ readonly id: string }>(
      "select id from tools order by id",
    )

    // Then: only the blueprint fixtures exist.
    expect(users.rows.map((row) => row.id)).toEqual(["mvp_admin", "mvp_user"])
    expect(skills.rows.map((row) => row.id)).toEqual([
      "calculator_assistant",
      "communication_assistant",
      "report_assistant",
    ])
    expect(tools.rows.map((row) => row.id)).toEqual([
      "calculator.evaluate",
      "job.get_status",
      "notification.preview",
      "notification.send_email",
      "report.generate",
      "skill.load",
    ])
  })

  it("rejects malformed rows with native PostgreSQL constraints", async () => {
    // Given: the migrated and seeded schema.
    await migrateAndSeed(context)
    await insertRunFixture(context, "run_constraints")

    // When/Then: invalid statuses, event sequences, and JSON fail at the database boundary.
    await expect(
      context.database.pool.query(
        "update runs set status = 'invented' where id = 'run_constraints'",
      ),
    ).rejects.toMatchObject({ code: "22P02" })
    await expect(
      context.database.pool.query(
        `insert into run_events
          (id, run_id, sequence, type, visibility, payload, correlation_id)
         values ('event_zero', 'run_constraints', 0, 'run.status_changed', 'user', '{}'::jsonb, 'correlation_1')`,
      ),
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      context.database.pool.query(
        "insert into run_events (id, run_id, sequence, type, visibility, payload, correlation_id) values ('event_json', 'run_constraints', 1, 'run.status_changed', 'user', $1::jsonb, 'correlation_1')",
        ["{broken"],
      ),
    ).rejects.toMatchObject({ code: "22P02" })
  })

  it("commits state, canonical event, and dispatch intent atomically", async () => {
    // Given: a queued run at aggregate version zero.
    await insertRunFixture(context, "run_atomic")

    // When: one canonical transition is persisted.
    await persistRunTransition(context.database, {
      runId: "run_atomic",
      runtime: "simple_loop",
      expectedVersion: 0,
      status: "running",
      event: {
        eventId: "event_atomic_1",
        sequence: 1,
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "queued", current: "running" },
        correlationId: "correlation_atomic",
      },
      dispatch: {
        id: "dispatch_atomic_1",
        deduplicationKey: "run_atomic:1",
        topic: "run.execute",
        payload: { runId: "run_atomic" },
      },
    })

    // Then: all three records committed together.
    const committed = await context.database.pool.query<{
      readonly version: number
      readonly event_count: string
      readonly intent_count: string
    }>(
      `select r.version,
        (select count(*) from run_events where run_id = r.id) event_count,
        (select count(*) from dispatch_intents where aggregate_id = r.id) intent_count
       from runs r where r.id = 'run_atomic'`,
    )
    expect(committed.rows[0]).toEqual({ version: 1, event_count: "1", intent_count: "1" })
  })

  it("rolls back the entire transition when its event conflicts", async () => {
    // Given: a run with an existing first event.
    await insertRunFixture(context, "run_rollback")
    await context.database.pool.query(
      `insert into run_events
        (id, run_id, sequence, type, visibility, payload, correlation_id)
       values ('event_existing', 'run_rollback', 1, 'run.status_changed', 'user', '{}'::jsonb, 'correlation_existing')`,
    )

    // When: a transaction attempts the duplicate sequence.
    const action = persistRunTransition(context.database, {
      runId: "run_rollback",
      runtime: "simple_loop",
      expectedVersion: 0,
      status: "running",
      event: {
        eventId: "event_conflict",
        sequence: 1,
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "queued", current: "running" },
        correlationId: "correlation_rollback",
      },
      dispatch: {
        id: "dispatch_rollback",
        deduplicationKey: "run_rollback:1",
        topic: "run.execute",
        payload: { runId: "run_rollback" },
      },
    })

    // Then: PostgreSQL rejects the event and rolls back state and intent.
    await expect(action).rejects.toMatchObject({ cause: { code: "23505" } })
    const rolledBack = await context.database.pool.query<{
      readonly status: string
      readonly version: number
      readonly intent_count: string
    }>(
      `select status, version,
        (select count(*) from dispatch_intents where aggregate_id = runs.id) intent_count
       from runs where id = 'run_rollback'`,
    )
    expect(rolledBack.rows[0]).toEqual({ status: "queued", version: 0, intent_count: "0" })
  })

  it("rejects runtime reassignment and stale aggregate versions", async () => {
    // Given: a Simple Loop run.
    await insertRunFixture(context, "run_fenced")
    const base = {
      runId: "run_fenced",
      expectedVersion: 0,
      status: "running" as const,
      event: {
        eventId: "event_fenced",
        sequence: 1,
        type: "run.status_changed",
        visibility: "user" as const,
        payload: { previous: "queued", current: "running" },
        correlationId: "correlation_fenced",
      },
      dispatch: {
        id: "dispatch_fenced",
        deduplicationKey: "run_fenced:1",
        topic: "run.execute",
        payload: { runId: "run_fenced" },
      },
    } as const

    // When/Then: the wrong runtime and wrong version return typed conflicts.
    await expect(
      persistRunTransition(context.database, { ...base, runtime: "state_workflow" }),
    ).rejects.toBeInstanceOf(ImmutableRuntimeAssignmentError)
    await expect(
      persistRunTransition(context.database, {
        ...base,
        runtime: "simple_loop",
        expectedVersion: 7,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError)
  })

  it("replays an idempotent result and rejects a changed request", async () => {
    // Given: one completed idempotency record.
    const first = await reserveIdempotency(context.database, {
      key: "idempotency_replay",
      scope: "chat.send_message",
      requestHash: "sha256:request-a",
      response: { runId: "run_replayed", status: "accepted" },
    })

    // When: the same and then a changed request reuse the key.
    const replay = await reserveIdempotency(context.database, {
      key: "idempotency_replay",
      scope: "chat.send_message",
      requestHash: "sha256:request-a",
      response: { ignored: true },
    })
    const conflict = reserveIdempotency(context.database, {
      key: "idempotency_replay",
      scope: "chat.send_message",
      requestHash: "sha256:request-b",
      response: { ignored: true },
    })

    // Then: replay returns the original result and changed input conflicts.
    expect(first.kind).toBe("stored")
    expect(replay).toEqual({
      kind: "replayed",
      response: { runId: "run_replayed", status: "accepted" },
    })
    await expect(conflict).rejects.toMatchObject({ code: "CONFLICT" })
  })
})
