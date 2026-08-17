import { ImmutableRuntimeAssignmentError, StaleLeaseError } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createAdmissionService,
  createClaimService,
  createProjectionService,
  createReconciliationService,
} from "../src/application/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"

describe("runtime isolation and projections", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("claims only Simple Loop runs and fences stale writers", async () => {
    // Given: one admitted run per runtime.
    const admission = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("claim"),
    })
    const simple = await admission.admit({
      commandId: "command_claim_simple",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_claim_simple",
        runtime: "simple_loop",
        message: "simple",
        idempotencyKey: "idempotency_claim_simple",
      },
    })
    await admission.admit({
      commandId: "command_claim_workflow",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_claim_workflow",
        runtime: "state_workflow",
        message: "workflow",
        idempotencyKey: "idempotency_claim_workflow",
      },
    })
    const claims = createClaimService(context.database)

    await expect(
      context.database.pool.query("update runs set runtime = 'state_workflow' where id = $1", [
        simple.runId,
      ]),
    ).rejects.toMatchObject({ code: "23514" })

    // When: a Simple Loop worker claims pending work.
    const lease = await claims.claimNext({ owner: "worker-simple-a", durationSeconds: 30 })

    // Then: only the Simple run is leased and a stale fence cannot write.
    expect(lease?.runId).toBe(simple.runId)
    await expect(
      claims.persist({
        runId: simple.runId,
        owner: "worker-simple-a",
        fencingVersion: (lease?.fencingVersion ?? 1) - 1,
        expectedVersion: lease?.version ?? 1,
        status: "running",
        event: {
          eventId: "event_stale_lease",
          runId: simple.runId,
          sequence: 2,
          type: "run.status_changed",
          visibility: "user",
          payload: { previous: "queued", current: "running" },
          correlationId: "correlation_stale_lease",
          occurredAt: "2026-08-16T12:00:00.000Z",
        },
        dispatch: {
          id: "dispatch_stale_lease",
          deduplicationKey: "stale-lease:2",
          topic: "simple_loop.execute",
          payload: { runId: simple.runId },
        },
      }),
    ).rejects.toBeInstanceOf(StaleLeaseError)
    await expect(
      claims.claimRun({
        runId: simple.runId,
        runtime: "state_workflow",
        owner: "wrong-worker",
        durationSeconds: 30,
      }),
    ).rejects.toBeInstanceOf(ImmutableRuntimeAssignmentError)
  })

  it("reconciles only pending State Workflow starts without delivery", async () => {
    // Given: one pending start and one pending Simple Loop execute intent.
    await context.database.pool.query(
      "update dispatch_intents set status = 'dispatched', dispatched_at = now() where topic = 'state_workflow.start'",
    )
    const admission = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("reconcile"),
    })
    await admission.admit({
      commandId: "command_reconcile_workflow",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_reconcile_workflow",
        runtime: "state_workflow",
        message: "workflow",
        idempotencyKey: "idempotency_reconcile_workflow",
      },
    })

    // When: reconciliation scans twice.
    const reconciliation = createReconciliationService(context.database)
    const first = await reconciliation.listWorkflowStarts()
    const replay = await reconciliation.listWorkflowStarts()

    // Then: the scan is stable, data-only, and runtime-specific.
    expect(first).toHaveLength(1)
    expect(replay).toEqual(first)
    expect(first.every((intent) => intent.runtime === "state_workflow")).toBe(true)
    expect(first.every((intent) => intent.workflowIdentity === `agent-run/${intent.runId}`)).toBe(
      true,
    )
  })

  it("filters model-only events from User projections and preserves monotonic cursors", async () => {
    // Given: one run with a hostile model-only command event.
    const admission = createAdmissionService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("projection"),
    })
    const receipt = await admission.admit({
      commandId: "command_projection",
      createdAt: "2026-08-16T12:00:00.000Z",
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_projection",
        runtime: "simple_loop",
        message: "visible",
        idempotencyKey: "idempotency_projection",
      },
    })
    await context.database.pool.query(
      `insert into run_events
        (id, run_id, sequence, type, visibility, payload, correlation_id, occurred_at)
       values ($1, $2, 2, 'admin.command.accepted', 'model_only', $3::jsonb, $4, $5)`,
      [
        "event_hostile_hidden",
        receipt.runId,
        JSON.stringify({ commandId: "admin_hostile", status: "accepted" }),
        "correlation_hostile",
        testClock.now(),
      ],
    )
    const projections = createProjectionService(context.database)

    // When: each role reads the same canonical run.
    const user = await projections.get({ viewer: "user", runId: receipt.runId })
    const admin = await projections.get({ viewer: "admin", runId: receipt.runId })

    // Then: User sees only public data while Admin preserves the hidden event.
    expect(user.events).toHaveLength(1)
    expect(admin.events).toHaveLength(2)
    await expect(
      projections.events({ viewer: "user", runId: receipt.runId, afterSequence: -1 }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
  })

  it("rejects malformed canonical events before a lease mutation", async () => {
    // Given: a Simple Loop claim service with malformed external event data.
    const claims = createClaimService(context.database)

    // When/Then: sequence zero fails contract parsing before any database lookup or write.
    await expect(
      claims.persist({
        runId: "run_malformed_event",
        owner: "worker-simple-malformed",
        fencingVersion: 1,
        expectedVersion: 0,
        status: "running",
        event: {
          eventId: "event_malformed",
          runId: "run_malformed_event",
          sequence: 0,
          type: "run.status_changed",
          visibility: "user",
          payload: { previous: "queued", current: "running" },
          correlationId: "correlation_malformed",
          occurredAt: "2026-08-16T12:00:00.000Z",
        },
        dispatch: {
          id: "dispatch_malformed",
          deduplicationKey: "malformed:0",
          topic: "simple_loop.execute",
          payload: { runId: "run_malformed_event" },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
  })
})
