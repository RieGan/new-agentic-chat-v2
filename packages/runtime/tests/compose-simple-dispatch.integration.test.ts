import { ConflictError } from "@agentic-chat/contracts"
import { listPendingDispatches } from "@agentic-chat/db"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { handleSimpleLoopDispatch } from "../src/compose-simple-dispatch.js"
import {
  type ApplicationTestContext,
  startApplicationTestContext,
  stopApplicationTestContext,
} from "./application-support.js"

const handledAt = new Date("2026-08-17T12:00:00.000Z")

const insertDispatch = async (
  context: ApplicationTestContext,
  namespace: string,
  status: "completed" | "queued" = "queued",
) => {
  const runId = `run_${namespace}`
  const intentId = `dispatch_${namespace}`
  await context.database.pool.query(
    "insert into conversations (id, user_id) values ($1, 'mvp_user')",
    [`conversation_${namespace}`],
  )
  await context.database.pool.query(
    "insert into runs (id, conversation_id, user_id, runtime, status) values ($1, $2, 'mvp_user', 'simple_loop', $3)",
    [runId, `conversation_${namespace}`, status],
  )
  await context.database.pool.query(
    `insert into dispatch_intents
      (id, aggregate_type, aggregate_id, deduplication_key, topic, payload)
     values ($1, 'run', $2, $3, 'simple_loop.execute', $4::jsonb)`,
    [intentId, runId, `simple-loop:${namespace}`, JSON.stringify({ runId })],
  )
  return { intentId, runId }
}

describe("Compose Simple Loop dispatch handling", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 120_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("acknowledges one handled intent so a replacement worker cannot replay it", async () => {
    // Given: one pending intent and an executor that durably completes its run.
    const identity = await insertDispatch(context, "handled_once")
    let executions = 0
    const executor = {
      execute: async () => {
        executions += 1
        await context.database.pool.query("update runs set status = 'completed' where id = $1", [
          identity.runId,
        ])
        return { status: "completed" as const }
      },
    }

    // When: the worker handles the exact intent and a replacement scans after restart.
    await handleSimpleLoopDispatch({
      database: context.database,
      executor,
      intent: { ...identity, topic: "simple_loop.execute", payload: { runId: identity.runId } },
      handledAt,
    })
    const pendingAfterRestart = (await listPendingDispatches(context.database)).filter(
      ({ intentId }) => intentId === identity.intentId,
    )

    // Then: the durable acknowledgement suppresses every later process-local replay.
    expect(executions).toBe(1)
    expect(pendingAfterRestart).toEqual([])
  })

  it("acknowledges a stale terminal delivery without logging it forever", async () => {
    // Given: a pending intent whose run was already durably completed.
    const identity = await insertDispatch(context, "already_terminal", "completed")
    const executor = {
      execute: async () => {
        throw new ConflictError(`terminal run ${identity.runId}`)
      },
    }

    // When: the stale delivery reaches a newly started worker.
    const result = await handleSimpleLoopDispatch({
      database: context.database,
      executor,
      intent: { ...identity, topic: "simple_loop.execute", payload: { runId: identity.runId } },
      handledAt,
    })

    // Then: terminal persistence proves prior delivery and removes the pending intent.
    expect(result.kind).toBe("already_handled")
    expect(
      (await listPendingDispatches(context.database)).some(
        ({ intentId }) => intentId === identity.intentId,
      ),
    ).toBe(false)
  })

  it("keeps the exact intent pending when execution fails before a durable boundary", async () => {
    // Given: an active queued run and a transient executor failure.
    const identity = await insertDispatch(context, "transient_failure")
    const transient = new TypeError("temporary provider outage")
    const executor = { execute: async () => Promise.reject(transient) }

    // When/Then: the failure propagates and remains retryable in PostgreSQL.
    await expect(
      handleSimpleLoopDispatch({
        database: context.database,
        executor,
        intent: { ...identity, topic: "simple_loop.execute", payload: { runId: identity.runId } },
        handledAt,
      }),
    ).rejects.toBe(transient)
    expect(
      (await listPendingDispatches(context.database)).some(
        ({ intentId }) => intentId === identity.intentId,
      ),
    ).toBe(true)
  })
})
