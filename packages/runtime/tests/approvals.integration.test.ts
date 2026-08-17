import { DuplicateError, InvalidApprovalError } from "@agentic-chat/contracts"
import { AsyncBarrier, MutableTestClock } from "@agentic-chat/testkit"
import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createApprovalService } from "../src/application/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
} from "./application-support.js"
import { insertControlFixture } from "./task-eight-support.js"

const ADMIN = { actorId: "mvp_admin" } as const
const USER = { actorId: "mvp_user" } as const

describe("exact approval service", () => {
  let context: ApplicationTestContext
  let clock: MutableTestClock

  beforeAll(async () => {
    context = await startApplicationTestContext()
    clock = new MutableTestClock(new Date("2026-08-16T12:00:00.000Z"))
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("binds an immutable snapshot and executes one approved simulated send", async () => {
    // Given: a canonical prepared send call and its selected skill snapshot.
    const fixture = await insertControlFixture(context, "approval_happy")
    const ledger = createInvocationLedger()
    const service = createApprovalService({
      database: context.database,
      clock,
      ids: createTestIds("approval_happy"),
      tools: createToolRegistry({ ledger }),
    })
    const approval = await service.prepare({
      runId: fixture.runId,
      callId: fixture.callId,
      expiresAt: "2026-08-16T12:05:00.000Z",
    })
    await expect(
      context.database.pool.query(
        "update approval_requests set arguments = $2::jsonb where id = $1",
        [approval.approvalId, JSON.stringify({ previewId: "preview_mutated" })],
      ),
    ).rejects.toMatchObject({ code: "23514" })

    // When: the fixed Admin approves and execution is retried.
    await service.decide(ADMIN, {
      decision: "approve",
      approvalId: approval.approvalId,
      callId: fixture.callId,
      expectedArgumentsHash: fixture.argumentsHash,
      expectedVersion: 0,
    })
    const executions = await Promise.allSettled([
      service.execute({
        runId: fixture.runId,
        approvalId: approval.approvalId,
        callId: fixture.callId,
      }),
      service.execute({
        runId: fixture.runId,
        approvalId: approval.approvalId,
        callId: fixture.callId,
      }),
    ])
    const fulfilled = executions.find((outcome) => outcome.status === "fulfilled")
    const rejected = executions.find((outcome) => outcome.status === "rejected")

    // Then: the exact snapshot is preserved and only one send can execute.
    expect(approval).toMatchObject({
      runId: fixture.runId,
      callId: fixture.callId,
      arguments: fixture.arguments,
      argumentsHash: fixture.argumentsHash,
      status: "pending",
    })
    expect(fulfilled).toMatchObject({
      status: "fulfilled",
      value: { toolName: "notification.send_email", status: "sent" },
    })
    expect(rejected).toMatchObject({ status: "rejected", reason: expect.any(DuplicateError) })
    expect(ledger.executionCount("notification.send_email")).toBe(1)
  })

  it("rejects without minting a send capability", async () => {
    // Given: one pending exact approval.
    const fixture = await insertControlFixture(context, "approval_reject")
    const ledger = createInvocationLedger()
    const service = createApprovalService({
      database: context.database,
      clock,
      ids: createTestIds("approval_reject"),
      tools: createToolRegistry({ ledger }),
    })
    const approval = await service.prepare({
      runId: fixture.runId,
      callId: fixture.callId,
      expiresAt: "2026-08-16T12:05:00.000Z",
    })

    // When: the fixed Admin rejects the call.
    const rejected = await service.decide(ADMIN, {
      decision: "reject",
      approvalId: approval.approvalId,
      callId: fixture.callId,
      expectedArgumentsHash: fixture.argumentsHash,
      expectedVersion: 0,
      reason: "MVP rejection test",
    })

    // Then: execution remains impossible and no send occurred.
    expect(rejected.status).toBe("rejected")
    await expect(
      service.execute({
        runId: fixture.runId,
        approvalId: approval.approvalId,
        callId: fixture.callId,
      }),
    ).rejects.toBeInstanceOf(InvalidApprovalError)
    expect(ledger.executionCount("notification.send_email")).toBe(0)
  })

  it("allows exactly one winner when approve and reject race", async () => {
    // Given: two Admin decisions released from one deterministic barrier.
    const fixture = await insertControlFixture(context, "approval_race")
    const service = createApprovalService({
      database: context.database,
      clock,
      ids: createTestIds("approval_race"),
      tools: createToolRegistry(),
    })
    const approval = await service.prepare({
      runId: fixture.runId,
      callId: fixture.callId,
      expiresAt: "2026-08-16T12:05:00.000Z",
    })
    const barrier = new AsyncBarrier(2)
    const decide = async (decision: "approve" | "reject") => {
      await barrier.wait()
      return service.decide(
        ADMIN,
        decision === "approve"
          ? {
              decision,
              approvalId: approval.approvalId,
              callId: fixture.callId,
              expectedArgumentsHash: fixture.argumentsHash,
              expectedVersion: 0,
            }
          : {
              decision,
              approvalId: approval.approvalId,
              callId: fixture.callId,
              expectedArgumentsHash: fixture.argumentsHash,
              expectedVersion: 0,
              reason: "race rejection",
            },
      )
    }

    // When: approve and reject reach PostgreSQL concurrently.
    const outcomes = await Promise.allSettled([decide("approve"), decide("reject")])

    // Then: one terminal decision wins transactionally.
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1)
  })

  it("rejects User context, wrong run, expiry, completion, and altered arguments", async () => {
    // Given: independent pending approvals for every invalid boundary.
    const userFixture = await insertControlFixture(context, "approval_user")
    const wrongRunFixture = await insertControlFixture(context, "approval_wrong_run")
    const expiredFixture = await insertControlFixture(context, "approval_expired")
    const completedFixture = await insertControlFixture(context, "approval_completed")
    const alteredFixture = await insertControlFixture(context, "approval_altered")
    const ledger = createInvocationLedger()
    const service = createApprovalService({
      database: context.database,
      clock,
      ids: createTestIds("approval_invalid"),
      tools: createToolRegistry({ ledger }),
    })
    const prepare = (fixture: typeof userFixture, expiresAt = "2026-08-16T12:05:00.000Z") =>
      service.prepare({ runId: fixture.runId, callId: fixture.callId, expiresAt })
    const [userApproval, wrongRunApproval, expiredApproval, completedApproval, alteredApproval] =
      await Promise.all([
        prepare(userFixture),
        prepare(wrongRunFixture),
        prepare(expiredFixture, "2026-08-16T12:00:01.000Z"),
        prepare(completedFixture),
        prepare(alteredFixture),
      ])
    await context.database.pool.query("update runs set status = 'completed' where id = $1", [
      completedFixture.runId,
    ])
    await context.database.pool.query(
      "update tool_calls set arguments = $2::jsonb, arguments_hash = $3 where id = $1",
      [alteredFixture.callId, JSON.stringify({ previewId: "preview_tampered" }), "tampered"],
    )
    clock.set(new Date("2026-08-16T12:00:02.000Z"))

    // When/Then: every invalid operation fails before a simulated send.
    await expect(
      service.decide(USER, {
        decision: "approve",
        approvalId: userApproval.approvalId,
        callId: userFixture.callId,
        expectedArgumentsHash: userFixture.argumentsHash,
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidApprovalError)
    await expect(
      service.execute({
        runId: userFixture.runId,
        approvalId: wrongRunApproval.approvalId,
        callId: wrongRunFixture.callId,
      }),
    ).rejects.toBeInstanceOf(InvalidApprovalError)
    for (const [fixture, approval] of [
      [expiredFixture, expiredApproval],
      [completedFixture, completedApproval],
      [alteredFixture, alteredApproval],
    ] as const) {
      await expect(
        service.decide(ADMIN, {
          decision: "approve",
          approvalId: approval.approvalId,
          callId: fixture.callId,
          expectedArgumentsHash: fixture.argumentsHash,
          expectedVersion: 0,
        }),
      ).rejects.toBeInstanceOf(InvalidApprovalError)
    }
    expect(ledger.executionCount("notification.send_email")).toBe(0)
  })
})
