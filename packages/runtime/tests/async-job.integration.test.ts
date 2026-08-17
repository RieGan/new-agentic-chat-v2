import { ReportJobTestControls } from "@agentic-chat/testkit"
import { createToolRegistry } from "@agentic-chat/tools"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import * as runtime from "../src/index.js"
import { createReportJobService, type ReportJobQueue } from "../src/index.js"
import { createReportJobTestService } from "../src/testing/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"

class RecordingReportQueue implements ReportJobQueue {
  readonly payloads: Parameters<ReportJobQueue["enqueue"]>[0][] = []

  async enqueue(payload: Parameters<ReportJobQueue["enqueue"]>[0]): Promise<void> {
    this.payloads.push(payload)
  }
}

class QueueUnavailableTestError extends Error {
  readonly name = "QueueUnavailableTestError"
}

class FailingOnceReportQueue extends RecordingReportQueue {
  private available = false

  override async enqueue(payload: Parameters<ReportJobQueue["enqueue"]>[0]): Promise<void> {
    await super.enqueue(payload)
    if (!this.available) {
      this.available = true
      throw new QueueUnavailableTestError()
    }
  }
}

describe("asynchronous report jobs", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 60_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("returns only after durable acceptance and before report completion", async () => {
    // Given: a report admission paused immediately after its PostgreSQL commit.
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ('conversation_async_admit', 'mvp_user')",
    )
    await context.database.pool.query(
      `insert into runs (id, conversation_id, user_id, runtime, status)
       values ('run_async_admit', 'conversation_async_admit', 'mvp_user', 'simple_loop', 'running')`,
    )
    const controls = new ReportJobTestControls({ pauseAfterAccept: true })
    const queue = new RecordingReportQueue()
    const service = createReportJobTestService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("async-admit"),
      queue,
      tools: createToolRegistry(),
      controls,
    })

    // When: admission reaches the test-only post-commit barrier.
    const pendingReceipt = service.admit({
      namespace: "async-job-suite",
      runId: "run_async_admit",
      callId: "call_async_admit",
      arguments: { topic: "quarterly", sections: ["summary"] },
    })
    await controls.waitUntilAccepted()

    // Then: queued state is durable before enqueue and the response never waits for completion.
    const durable = await context.database.pool.query<{
      readonly id: string
      readonly status: string
      readonly percent: number
    }>(
      "select id, status, percent from jobs where namespace = 'async-job-suite' and run_id = 'run_async_admit'",
    )
    expect(durable.rows).toEqual([{ id: "job_001", status: "queued", percent: 0 }])
    expect(queue.payloads).toEqual([])
    controls.releaseAcceptance()
    await expect(pendingReceipt).resolves.toEqual({ jobId: "job_001", status: "queued" })
    expect(queue.payloads).toHaveLength(1)
    expect(queue.payloads[0]).toMatchObject({
      namespace: "async-job-suite",
      runId: "run_async_admit",
      callId: "call_async_admit",
      jobId: "job_001",
      reportId: "report_001",
    })
    expect(queue.payloads[0]?.bullmqJobId).not.toContain(":")
  })

  it("recovers accepted work when the first queue dispatch is lost", async () => {
    // Given: PostgreSQL is available while the first queue delivery fails after acceptance.
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ('conversation_async_dispatch', 'mvp_user')",
    )
    await context.database.pool.query(
      `insert into runs (id, conversation_id, user_id, runtime, status)
       values ('run_async_dispatch', 'conversation_async_dispatch', 'mvp_user', 'simple_loop', 'running')`,
    )
    const queue = new FailingOnceReportQueue()
    const service = createReportJobService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("async-dispatch"),
      queue,
      tools: createToolRegistry(),
    })

    // When: reconciliation scans the durable pending intent after the failed dispatch.
    await expect(
      service.admit({
        namespace: "async-job-dispatch-suite",
        runId: "run_async_dispatch",
        callId: "call_async_dispatch",
        arguments: { topic: "quarterly", sections: ["summary"] },
      }),
    ).rejects.toBeInstanceOf(QueueUnavailableTestError)
    await service.dispatchPending()

    // Then: the same deterministic transport identity is delivered and marked once.
    expect(queue.payloads).toHaveLength(2)
    expect(queue.payloads[0]).toEqual(queue.payloads[1])
    const state = await context.database.pool.query<{
      readonly jobs: string
      readonly pending: string
      readonly dispatched: string
    }>(
      `select
        (select count(*) from jobs where run_id = 'run_async_dispatch')::text jobs,
        (select count(*) from dispatch_intents where aggregate_id = (select ledger_key from jobs where run_id = 'run_async_dispatch') and status = 'pending')::text pending,
        (select count(*) from dispatch_intents where aggregate_id = (select ledger_key from jobs where run_id = 'run_async_dispatch') and status = 'dispatched' and attempts = 1)::text dispatched`,
    )
    expect(state.rows[0]).toEqual({ jobs: "1", pending: "0", dispatched: "1" })
  })

  it("rejects test barriers outside test configuration", () => {
    // Given: a process explicitly running in production mode.
    vi.stubEnv("NODE_ENV", "production")

    // When/Then: test controls cannot construct a production service.
    try {
      expect(() =>
        createReportJobTestService({
          database: context.database,
          clock: testClock,
          ids: createTestIds("forbidden-controls"),
          queue: new RecordingReportQueue(),
          tools: createToolRegistry(),
          controls: new ReportJobTestControls(),
        }),
      ).toThrow("Report job test controls require NODE_ENV=test")
    } finally {
      vi.unstubAllEnvs()
    }
    expect("createReportJobTestService" in runtime).toBe(false)
    expect("createReportFixtureTestWorker" in runtime).toBe(false)
  })
})
