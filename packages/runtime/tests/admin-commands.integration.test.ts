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
      runId: fixture.runId,
      instruction: "For the next response, use the approved Admin guidance.",
      expiresAt: "2026-08-16T12:05:00.000Z",
      idempotencyKey: "idempotency_admin_happy",
    }
    const accepted = await service.submit(ADMIN, input)
    const replay = await service.submit(ADMIN, input)

    // When: the runtime consumes it immediately before model execution.
    const applied = await service.applyAtBoundary({
      runId: fixture.runId,
      commandId: accepted.commandId,
      boundary: "before_model",
    })

    // Then: one identity is applied once and raw content stays outside User projection data.
    expect(replay.commandId).toBe(accepted.commandId)
    expect(applied).toMatchObject({
      instruction: input.instruction,
      command: { status: "applied" },
    })
    await expect(
      service.applyAtBoundary({
        runId: fixture.runId,
        commandId: accepted.commandId,
        boundary: "before_model",
      }),
    ).rejects.toBeInstanceOf(InvalidAdminCommandError)
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
    expect(records.rows).toHaveLength(2)
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
      runId: fixture.runId,
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

  it("rejects expired, wrong-run, completed-run, and unsafe-boundary application", async () => {
    // Given: accepted commands for independent active targets.
    const expiredFixture = await insertControlFixture(context, "admin_expired")
    const wrongRunFixture = await insertControlFixture(context, "admin_wrong_run")
    const otherFixture = await insertControlFixture(context, "admin_other_run")
    const completedFixture = await insertControlFixture(context, "admin_completed", "completed")
    const unsafeFixture = await insertControlFixture(context, "admin_unsafe")
    const service = createAdminCommandService({
      database: context.database,
      clock,
      ids: createTestIds("admin_invalid"),
    })
    const submit = (runId: string, key: string, expiresAt = "2026-08-16T12:05:00.000Z") =>
      service.submit(ADMIN, {
        runId,
        instruction: `guidance ${key}`,
        expiresAt,
        idempotencyKey: key,
      })
    const expired = await submit(
      expiredFixture.runId,
      "idempotency_admin_expired",
      "2026-08-16T12:00:01.000Z",
    )
    const wrongRun = await submit(wrongRunFixture.runId, "idempotency_admin_wrong_run")
    const unsafe = await submit(unsafeFixture.runId, "idempotency_admin_unsafe")
    clock.set(new Date("2026-08-16T12:00:02.000Z"))

    // When/Then: no invalid target, lifetime, terminal run, or boundary can consume guidance.
    await expect(
      service.applyAtBoundary({
        runId: expiredFixture.runId,
        commandId: expired.commandId,
        boundary: "before_model",
      }),
    ).rejects.toBeInstanceOf(InvalidAdminCommandError)
    await expect(
      service.applyAtBoundary({
        runId: otherFixture.runId,
        commandId: wrongRun.commandId,
        boundary: "before_model",
      }),
    ).rejects.toBeInstanceOf(InvalidAdminCommandError)
    await expect(
      submit(completedFixture.runId, "idempotency_admin_completed"),
    ).rejects.toBeInstanceOf(InvalidAdminCommandError)
    await expect(
      service.applyAtBoundary({
        runId: unsafeFixture.runId,
        commandId: unsafe.commandId,
        boundary: "in_flight",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
  })
})
