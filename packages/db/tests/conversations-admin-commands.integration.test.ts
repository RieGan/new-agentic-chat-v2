import { ConflictError, MessageIdSchema } from "@agentic-chat/contracts"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  admitNewRun,
  claimAdminCommandAtBoundary,
  createConversation,
  listConversations,
  submitAdminCommand,
} from "../src/index.js"
import { migrateAndSeed, startTestContext, stopTestContext, type TestContext } from "./support.js"

const owner = "mvp_user"
const baseTime = new Date("2026-08-16T12:00:00.000Z")

describe.sequential("conversation persistence and hidden command claims", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
    await migrateAndSeed(context)
  }, 120_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("creates conversations idempotently and lists only the owner in stable recency order", async () => {
    // Given: two same-owner identities with equal recency and one foreign conversation.
    await createConversation(context.database, {
      conversationId: "conversation_list_b",
      userId: owner,
      now: baseTime,
    })
    const first = await createConversation(context.database, {
      conversationId: "conversation_list_a",
      userId: owner,
      now: baseTime,
    })
    const replay = await createConversation(context.database, {
      conversationId: "conversation_list_a",
      userId: owner,
      now: new Date("2026-08-16T13:00:00.000Z"),
    })
    await createConversation(context.database, {
      conversationId: "conversation_list_foreign",
      userId: "mvp_admin",
      now: new Date("2026-08-16T14:00:00.000Z"),
    })

    // When: the owner lists conversations.
    const listed = await listConversations(context.database, { userId: owner })

    // Then: replay preserves identity and ties are broken by descending ID.
    expect(replay).toEqual(first)
    expect(listed.map((row) => row.id)).toEqual(["conversation_list_b", "conversation_list_a"])
    await expect(
      createConversation(context.database, {
        conversationId: "conversation_list_a",
        userId: "mvp_admin",
        now: baseTime,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("requires an owned conversation before admitting a run and refreshes its recency", async () => {
    // Given: one explicitly created conversation.
    await createConversation(context.database, {
      conversationId: "conversation_admission_existing",
      userId: owner,
      now: baseTime,
    })
    const admittedAt = new Date("2026-08-16T12:05:00.000Z")

    // When: a new run is admitted into that conversation.
    await admitNewRun(context.database, {
      key: "admission-existing-conversation",
      requestHash: "sha256:admission-existing-conversation",
      receipt: { commandId: "command_admission", status: "accepted", runId: "run_admission" },
      messageId: MessageIdSchema.parse("message_admission"),
      eventId: "event_admission",
      dispatchId: "dispatch_admission",
      occurredAt: admittedAt,
      conversationId: "conversation_admission_existing",
      runtime: "simple_loop",
      message: "start",
      correlationId: "correlation_admission",
    })

    // Then: the existing aggregate is refreshed and a missing aggregate is rejected.
    const rows = await context.database.pool.query<{ readonly updated_at: Date }>(
      "select updated_at from conversations where id = 'conversation_admission_existing'",
    )
    expect(rows.rows[0]?.updated_at).toEqual(admittedAt)
    await expect(
      admitNewRun(context.database, {
        key: "admission-missing-conversation",
        requestHash: "sha256:admission-missing-conversation",
        receipt: { commandId: "command_missing", status: "accepted", runId: "run_missing" },
        messageId: MessageIdSchema.parse("message_missing"),
        eventId: "event_missing",
        dispatchId: "dispatch_missing",
        occurredAt: admittedAt,
        conversationId: "conversation_missing",
        runtime: "simple_loop",
        message: "start",
        correlationId: "correlation_missing",
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it("claims FIFO guidance once per conversation boundary and replays deterministically", async () => {
    // Given: two running runs and two commands owned by their shared conversation.
    await insertConversationRuns(context, "claim", ["run_claim_a", "run_claim_b"])
    await submit(context, "command_claim_a", "conversation_claim", "first", 0)
    await submit(context, "command_claim_b", "conversation_claim", "second", 1)

    // When: two boundaries consume and the first boundary is replayed.
    const first = await claim(context, "run_claim_a", "boundary-a", "event_claim_a")
    const replay = await claim(context, "run_claim_a", "boundary-a", "event_claim_replay")
    const second = await claim(context, "run_claim_b", "boundary-b", "event_claim_b")

    // Then: FIFO and replay identities are stable, with one applied event per consumption.
    expect(first?.id).toBe("command_claim_a")
    expect(replay?.id).toBe("command_claim_a")
    expect(second?.id).toBe("command_claim_b")
    const events = await context.database.pool.query<{
      readonly id: string
      readonly run_id: string
    }>(
      "select id, run_id from run_events where run_id in ('run_claim_a', 'run_claim_b') order by id",
    )
    expect(events.rows).toEqual([
      { id: "event_claim_a", run_id: "run_claim_a" },
      { id: "event_claim_b", run_id: "run_claim_b" },
    ])
  })

  it("expires stale guidance and never consumes another conversation command", async () => {
    // Given: an expired head, a live successor, and a command in another conversation.
    await insertConversationRuns(context, "expiry", ["run_expiry"])
    await insertConversationRuns(context, "isolated", ["run_isolated"])
    await submit(context, "command_expired", "conversation_expiry", "expired", 0, 1)
    await submit(context, "command_live", "conversation_expiry", "live", 1, 10)
    await submit(context, "command_isolated", "conversation_isolated", "isolated", 0, 10)

    // When: the expiry conversation reaches a boundary after the head expires.
    const claimed = await claim(
      context,
      "run_expiry",
      "boundary-expiry",
      "event_expiry",
      new Date("2026-08-16T12:02:00.000Z"),
    )

    // Then: the stale head expires, the live successor applies, and isolation remains intact.
    expect(claimed?.id).toBe("command_live")
    const states = await context.database.pool.query<{
      readonly id: string
      readonly status: string
      readonly applied_run_id: string | null
    }>(
      "select id, status, applied_run_id from admin_commands where id like 'command_%' and conversation_id in ('conversation_expiry', 'conversation_isolated') order by id",
    )
    expect(states.rows).toEqual([
      { id: "command_expired", status: "expired", applied_run_id: null },
      { id: "command_isolated", status: "accepted", applied_run_id: null },
      { id: "command_live", status: "applied", applied_run_id: "run_expiry" },
    ])
  })

  it("serializes concurrent run boundaries without double consumption", async () => {
    // Given: one command and two running runs in its conversation.
    await insertConversationRuns(context, "race", ["run_race_a", "run_race_b"])
    await submit(context, "command_race", "conversation_race", "once", 0)

    // When: both run boundaries claim concurrently.
    const claims = await Promise.all([
      claim(context, "run_race_a", "boundary-race-a", "event_race_a"),
      claim(context, "run_race_b", "boundary-race-b", "event_race_b"),
    ])

    // Then: one boundary consumes the command and the other observes no command.
    expect(claims.filter((command) => command !== null)).toHaveLength(1)
    const applied = await context.database.pool.query<{ readonly count: string }>(
      "select count(*) from admin_commands where id = 'command_race' and status = 'applied'",
    )
    expect(applied.rows[0]?.count).toBe("1")
  })
})

const insertConversationRuns = async (
  context: TestContext,
  suffix: string,
  runIds: readonly string[],
): Promise<void> => {
  const conversationId = `conversation_${suffix}`
  await createConversation(context.database, { conversationId, userId: owner, now: baseTime })
  for (const runId of runIds) {
    await context.database.pool.query(
      "insert into runs (id, conversation_id, user_id, runtime, status) values ($1, $2, $3, 'simple_loop', 'running')",
      [runId, conversationId, owner],
    )
  }
}

const submit = async (
  context: TestContext,
  commandId: string,
  conversationId: string,
  instruction: string,
  offsetMilliseconds: number,
  expiryMinutes = 5,
) =>
  submitAdminCommand(context.database, {
    commandId,
    conversationId,
    instruction,
    expiresAt: new Date(baseTime.getTime() + expiryMinutes * 60_000),
    idempotencyKey: `idempotency_${commandId}`,
    now: new Date(baseTime.getTime() + offsetMilliseconds),
  })

const claim = (
  context: TestContext,
  runId: string,
  boundaryKey: string,
  eventId: string,
  now = baseTime,
) =>
  claimAdminCommandAtBoundary(context.database, {
    runId,
    boundaryKey,
    now,
    eventId,
    correlationId: `correlation_${eventId}`,
  })
