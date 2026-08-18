import { ConflictError, InvalidAdminCommandError } from "@agentic-chat/contracts"
import { MutableTestClock } from "@agentic-chat/testkit"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAdminCommandService, createProjectionService } from "../src/application/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
} from "./application-support.js"
import { insertControlFixture } from "./task-eight-support.js"

const ADMIN = { actorId: "mvp_admin" } as const
const USER = { actorId: "mvp_user" } as const

describe("hidden Admin command service", () => {
  let context: ApplicationTestContext
  let clock: MutableTestClock

  beforeAll(async () => {
    context = await startApplicationTestContext()
    clock = new MutableTestClock(new Date("2026-08-16T12:00:00.000Z"))
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("applies an idempotent target-bound command once at the declared safe boundary", async () => {
    // Given: an active run and one hidden fixed-Admin instruction.
    const fixture = await insertControlFixture(context, "admin_happy")
    const service = createAdminCommandService({
      database: context.database,
      clock,
      ids: createTestIds("admin_happy"),
    })
    const input = {
      conversationId: fixture.conversationId,
      instruction: "For the next response, use the approved Admin guidance.",
      expiresAt: "2026-08-16T12:05:00.000Z",
      idempotencyKey: "idempotency_admin_happy",
    }
    const accepted = await service.submit(ADMIN, input)
    const replay = await service.submit(ADMIN, input)

    // When: the runtime consumes it immediately before model execution.
    const applied = await service.claimAtBoundary({
      runId: fixture.runId,
      boundaryKey: `${fixture.runId}/before_model/step/1`,
    })

    // Then: one identity is applied once and raw content stays outside User projection data.
    expect(replay.commandId).toBe(accepted.commandId)
    expect(applied).toMatchObject({
      instruction: input.instruction,
      command: { status: "applied" },
    })
    const boundaryReplay = await service.claimAtBoundary({
      runId: fixture.runId,
      boundaryKey: `${fixture.runId}/before_model/step/1`,
    })
    expect(boundaryReplay?.command.commandId).toBe(accepted.commandId)
    const projection = await createProjectionService(context.database).get({
      viewer: "user",
      runId: fixture.runId,
    })
    expect(JSON.stringify(projection)).not.toContain(input.instruction)
    expect(projection.events).toHaveLength(0)
    const records = await context.database.pool.query<{ readonly event_payload: string }>(
      "select payload::text event_payload from run_events where run_id = $1 order by sequence",
      [fixture.runId],
    )
    expect(records.rows).toHaveLength(1)
    expect(records.rows.every((row) => !row.event_payload.includes(input.instruction))).toBe(true)
  })

  it("rejects User context and changed idempotency input", async () => {
    // Given: an active target and one accepted idempotency key.
    const fixture = await insertControlFixture(context, "admin_context")
    const service = createAdminCommandService({
      database: context.database,
      clock,
      ids: createTestIds("admin_context"),
    })
    const input = {
      conversationId: fixture.conversationId,
      instruction: "Authorized guidance",
      expiresAt: "2026-08-16T12:05:00.000Z",
      idempotencyKey: "idempotency_admin_context",
    }
    await service.submit(ADMIN, input)

    // When/Then: context cannot be forged and an idempotency key cannot change meaning.
    await expect(service.submit(USER, input)).rejects.toBeInstanceOf(InvalidAdminCommandError)
    await expect(
      service.submit(ADMIN, { ...input, instruction: "Changed guidance" }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("accepts terminal and idle session commands but only claims at a running boundary", async () => {
    // Given: accepted commands for expired, terminal, and run-less sessions.
    const expiredFixture = await insertControlFixture(context, "admin_expired")
    const completedFixture = await insertControlFixture(context, "admin_completed", "completed")
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ('conversation_admin_idle', 'mvp_user')",
    )
    const service = createAdminCommandService({
      database: context.database,
      clock,
      ids: createTestIds("admin_invalid"),
    })
    const submit = (conversationId: string, key: string, expiresAt = "2026-08-16T12:05:00.000Z") =>
      service.submit(ADMIN, {
        conversationId,
        instruction: `guidance ${key}`,
        expiresAt,
        idempotencyKey: key,
      })
    await submit(
      expiredFixture.conversationId,
      "idempotency_admin_expired",
      "2026-08-16T12:00:01.000Z",
    )
    const terminal = await submit(completedFixture.conversationId, "idempotency_admin_completed")
    const idle = await submit("conversation_admin_idle", "idempotency_admin_idle")
    clock.set(new Date("2026-08-16T12:00:02.000Z"))

    // When/Then: submission remains session-owned while runtime state gates consumption.
    expect(terminal.status).toBe("accepted")
    expect(idle.status).toBe("accepted")
    await expect(
      service.claimAtBoundary({
        runId: completedFixture.runId,
        boundaryKey: `${completedFixture.runId}/before_model/step/1`,
      }),
    ).rejects.toBeInstanceOf(InvalidAdminCommandError)
    await expect(
      service.claimAtBoundary({
        runId: expiredFixture.runId,
        boundaryKey: `${expiredFixture.runId}/before_model/step/1`,
      }),
    ).resolves.toBeNull()
  })
})
