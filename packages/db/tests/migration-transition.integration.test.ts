import { readFile } from "node:fs/promises"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { seedDatabase } from "../src/index.js"
import { startTestContext, stopTestContext, type TestContext } from "./support.js"

const migration = (name: string) =>
  readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")

describe("conversation-owned command migration", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("expires legacy pending commands without widening them to another conversation", async () => {
    // Given: the previous development schema with pending and applied run-owned commands.
    for (const file of [
      "0000_lively_sandman.sql",
      "0001_immutable_run_runtime.sql",
      "0002_nervous_charles_xavier.sql",
      "0003_last_hex.sql",
    ]) {
      await context.database.pool.query(await migration(file))
    }
    await seedDatabase(context.database)
    await context.database.pool.query(
      `insert into conversations (id, user_id) values ('conversation_legacy', 'mvp_user');
       insert into runs (id, conversation_id, user_id, runtime, status)
       values ('run_legacy', 'conversation_legacy', 'mvp_user', 'simple_loop', 'running');
       insert into admin_commands
         (id, run_id, actor_id, instruction, visibility, status, idempotency_key, expires_at, applied_at)
       values
         ('command_legacy_pending', 'run_legacy', 'mvp_admin', 'pending', 'model_only', 'accepted', 'legacy-pending', now() + interval '1 hour', null),
         ('command_legacy_applied', 'run_legacy', 'mvp_admin', 'applied', 'model_only', 'applied', 'legacy-applied', now() + interval '1 hour', now())`,
    )

    // When: the conversation-owned migration is applied.
    await context.database.pool.query(await migration("0004_conversation_owned_admin_commands.sql"))

    // Then: pending scope is discarded while historical application remains attributable.
    const rows = await context.database.pool.query<{
      readonly id: string
      readonly conversation_id: string
      readonly applied_run_id: string | null
      readonly boundary_key: string | null
      readonly status: string
    }>(
      "select id, conversation_id, applied_run_id, boundary_key, status from admin_commands order by id",
    )
    expect(rows.rows).toEqual([
      {
        id: "command_legacy_applied",
        conversation_id: "conversation_legacy",
        applied_run_id: "run_legacy",
        boundary_key: "legacy:command_legacy_applied",
        status: "applied",
      },
      {
        id: "command_legacy_pending",
        conversation_id: "conversation_legacy",
        applied_run_id: null,
        boundary_key: null,
        status: "expired",
      },
    ])
  })
})
