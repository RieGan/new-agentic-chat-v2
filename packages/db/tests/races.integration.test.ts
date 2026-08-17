import { IllegalTransitionError, StaleLeaseError, StaleVersionError } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  appendRunEvent,
  claimRunLease,
  decideApproval,
  enterStateWorkflowWait,
  recordSimulatedSend,
  releaseForSimpleLoopWait,
  updateRunWithLease,
} from "../src/index.js"
import {
  APPROVAL_ARGUMENTS_HASH,
  insertApprovalFixture,
  insertRunFixture,
  migrateAndSeed,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "./support.js"

describe.sequential("PostgreSQL race controls", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
    await migrateAndSeed(context)
  }, 120_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("allows exactly one terminal approval decision", async () => {
    // Given: one pending exact-argument approval.
    const identity = {
      runId: "run_approval_race",
      callId: "call_approval_race",
      approvalId: "approval_race",
    }
    await insertApprovalFixture(context, identity)

    // When: approve and reject race concurrently.
    const outcomes = await Promise.allSettled([
      decideApproval(context.database, {
        ...identity,
        actionId: "approval_action_approve",
        actorId: "mvp_admin",
        decision: "approved",
        expectedArgumentsHash: APPROVAL_ARGUMENTS_HASH,
        expectedVersion: 0,
      }),
      decideApproval(context.database, {
        ...identity,
        actionId: "approval_action_reject",
        actorId: "mvp_admin",
        decision: "rejected",
        reason: "race rejection",
        expectedArgumentsHash: APPROVAL_ARGUMENTS_HASH,
        expectedVersion: 0,
      }),
    ])

    // Then: one transaction wins and one durable action exists.
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1)
    const actions = await context.database.pool.query<{ readonly count: string }>(
      "select count(*) from approval_actions where approval_id = 'approval_race'",
    )
    expect(actions.rows[0]?.count).toBe("1")
  })

  it("deduplicates concurrent simulated sends by call identity", async () => {
    // Given: one approved email call.
    const identity = {
      runId: "run_send_race",
      callId: "call_send_race",
      approvalId: "approval_send_race",
    }
    await insertApprovalFixture(context, identity)
    await decideApproval(context.database, {
      ...identity,
      actionId: "approval_action_send_race",
      actorId: "mvp_admin",
      decision: "approved",
      expectedArgumentsHash: APPROVAL_ARGUMENTS_HASH,
      expectedVersion: 0,
    })

    // When: two workers record the same simulated side effect.
    const sends = await Promise.all([
      recordSimulatedSend(context.database, {
        callId: identity.callId,
        messageId: "message_external_001",
      }),
      recordSimulatedSend(context.database, {
        callId: identity.callId,
        messageId: "message_external_001",
      }),
    ])

    // Then: both observe one canonical send row.
    expect(sends[0]).toEqual(sends[1])
    const count = await context.database.pool.query<{ readonly count: string }>(
      "select count(*) from simulated_sends where call_id = 'call_send_race'",
    )
    expect(count.rows[0]?.count).toBe("1")
  })

  it("enforces one event per run sequence under concurrent append", async () => {
    // Given: one active run.
    await insertRunFixture(context, "run_event_race")
    const event = {
      runId: "run_event_race",
      sequence: 1,
      type: "run.status_changed",
      visibility: "user" as const,
      payload: { previous: "queued", current: "running" },
      correlationId: "correlation_event_race",
    } as const

    // When: two event IDs race for the same sequence.
    const outcomes = await Promise.allSettled([
      appendRunEvent(context.database, { ...event, eventId: "event_race_a" }),
      appendRunEvent(context.database, { ...event, eventId: "event_race_b" }),
    ])

    // Then: the unique run sequence admits one winner.
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1)
    const count = await context.database.pool.query<{ readonly count: string }>(
      "select count(*) from run_events where run_id = 'run_event_race' and sequence = 1",
    )
    expect(count.rows[0]?.count).toBe("1")
  })

  it("fences stale aggregate and lease writers", async () => {
    // Given: a Simple Loop run claimed with fencing token one.
    await insertRunFixture(context, "run_lease")
    const lease = await claimRunLease(context.database, {
      runId: "run_lease",
      runtime: "simple_loop",
      owner: "worker-a",
      expectedVersion: 0,
      durationSeconds: 30,
    })

    // When/Then: a stale version and stale fence cannot mutate the run.
    await expect(
      claimRunLease(context.database, {
        runId: "run_lease",
        runtime: "simple_loop",
        owner: "worker-b",
        expectedVersion: 0,
        durationSeconds: 30,
      }),
    ).rejects.toBeInstanceOf(StaleVersionError)
    await expect(
      updateRunWithLease(context.database, {
        runId: "run_lease",
        owner: "worker-a",
        fencingVersion: lease.fencingVersion - 1,
        expectedVersion: lease.version,
        status: "running",
      }),
    ).rejects.toBeInstanceOf(StaleLeaseError)
  })

  it("rejects a direct Simple Loop wait entry from queued before persistence", async () => {
    // Given: a queued Simple Loop run has a valid lease but has not entered running.
    await insertRunFixture(context, "run_illegal_simple_wait")
    const lease = await claimRunLease(context.database, {
      runId: "run_illegal_simple_wait",
      runtime: "simple_loop",
      owner: "worker-illegal-simple",
      expectedVersion: 0,
      durationSeconds: 30,
    })

    // When: an internal caller attempts queued -> waiting_for_tool directly.
    const transition = context.database.db.transaction((transaction) =>
      releaseForSimpleLoopWait(
        transaction,
        {
          runId: "run_illegal_simple_wait",
          owner: lease.owner,
          fencingVersion: lease.fencingVersion,
          expectedVersion: lease.version,
          occurredAt: new Date(),
          eventId: "event_illegal_simple_wait",
          statusEventId: "event_illegal_simple_wait_status",
          correlationId: "correlation_illegal_simple_wait",
          context: null,
        },
        "waiting_for_tool",
      ),
    )

    // Then: canonical transition validation rejects and the transaction persists nothing.
    await expect(transition).rejects.toBeInstanceOf(IllegalTransitionError)
    const persisted = await context.database.pool.query<{
      readonly status: string
      readonly eventCount: string
    }>(
      `select status,
        (select count(*) from run_events where run_id = runs.id) "eventCount"
       from runs where id = 'run_illegal_simple_wait'`,
    )
    expect(persisted.rows).toEqual([{ status: "queued", eventCount: "0" }])
  })

  it("rejects a direct State Workflow wait entry from queued before persistence", async () => {
    // Given: a queued State Workflow run has its immutable workflow identity.
    await insertRunFixture(context, "run_illegal_workflow_wait", "state_workflow")
    await context.database.pool.query("update runs set workflow_identity = $1 where id = $2", [
      "agent-run/run_illegal_workflow_wait",
      "run_illegal_workflow_wait",
    ])

    // When: an internal caller attempts queued -> waiting_for_admin directly.
    const transition = context.database.db.transaction((transaction) =>
      enterStateWorkflowWait(
        transaction,
        {
          runId: "run_illegal_workflow_wait",
          workflowId: "agent-run/run_illegal_workflow_wait",
          expectedVersion: 0,
          occurredAt: new Date(),
          eventId: "event_illegal_workflow_wait",
          statusEventId: "event_illegal_workflow_wait_status",
          correlationId: "correlation_illegal_workflow_wait",
          context: null,
        },
        "waiting_for_admin",
      ),
    )

    // Then: canonical transition validation rejects and the transaction persists nothing.
    await expect(transition).rejects.toBeInstanceOf(IllegalTransitionError)
    const persisted = await context.database.pool.query<{
      readonly status: string
      readonly eventCount: string
    }>(
      `select status,
        (select count(*) from run_events where run_id = runs.id) "eventCount"
       from runs where id = 'run_illegal_workflow_wait'`,
    )
    expect(persisted.rows).toEqual([{ status: "queued", eventCount: "0" }])
  })
})
