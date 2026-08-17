import { readReportJob } from "@agentic-chat/db"
import { ReportJobTestControls } from "@agentic-chat/testkit"
import { createToolRegistry } from "@agentic-chat/tools"
import { Queue } from "bullmq"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createBullReportQueue, REPORT_QUEUE_NAME } from "../src/index.js"
import { createReportFixtureTestWorker, createReportJobTestService } from "../src/testing/index.js"
import {
  type ApplicationTestContext,
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"
import {
  type RedisTestContext,
  startRedisTestContext,
  stopRedisTestContext,
} from "./async-job-support.js"

describe("BullMQ report fixture worker", () => {
  let context: ApplicationTestContext
  let redis: RedisTestContext

  beforeAll(async () => {
    ;[context, redis] = await Promise.all([startApplicationTestContext(), startRedisTestContext()])
  }, 60_000)

  afterAll(async () => {
    await Promise.all([stopApplicationTestContext(context), stopRedisTestContext(redis)])
  })

  it("reconciles completion after retry, dropped live events, and duplicate delivery", async () => {
    // Given: a BullMQ worker crashes once after durable progress and holds its retry before completion.
    await context.database.pool.query(
      "insert into conversations (id, user_id) values ('conversation_async_worker', 'mvp_user')",
    )
    await context.database.pool.query(
      `insert into runs (id, conversation_id, user_id, runtime, status)
       values ('run_async_worker', 'conversation_async_worker', 'mvp_user', 'simple_loop', 'running')`,
    )
    const controls = new ReportJobTestControls({
      holdCompletion: true,
      crashAfterProgressOnce: true,
      duplicateDelivery: true,
    })
    const queue = createBullReportQueue({ redisUrl: redis.redisUrl })
    const worker = createReportFixtureTestWorker({
      redisUrl: redis.redisUrl,
      database: context.database,
      clock: testClock,
      controls,
    })
    await worker.waitUntilReady()
    const service = createReportJobTestService({
      database: context.database,
      clock: testClock,
      ids: createTestIds("async-worker"),
      queue,
      tools: createToolRegistry(),
      controls,
    })

    // When: the retry reaches 50%, completes, and no BullMQ completion event is consumed.
    await service.admit({
      namespace: "async-job-worker-suite",
      runId: "run_async_worker",
      callId: "call_async_worker",
      arguments: { topic: "quarterly", sections: ["summary"] },
    })
    await controls.waitUntilCompletionHeld()
    const running = await readReportJob(context.database, {
      namespace: "async-job-worker-suite",
      runId: "run_async_worker",
      jobId: "job_001",
    })
    controls.releaseCompletion()
    await controls.waitUntilCompleted()
    const reconciled = await service.getStatus({
      namespace: "async-job-worker-suite",
      runId: "run_async_worker",
      jobId: "job_001",
    })

    // Then: PostgreSQL replays one canonical result and BullMQ retains one deterministic transport job.
    expect(running).toMatchObject({ status: "running", percent: 50, version: 1 })
    expect(reconciled).toEqual({
      toolName: "job.get_status",
      jobId: "job_001",
      status: "completed",
      reportId: "report_001",
    })
    const completed = await readReportJob(context.database, {
      namespace: "async-job-worker-suite",
      runId: "run_async_worker",
      jobId: "job_001",
    })
    if (!completed) throw new TypeError("Expected completed report job")
    await queue.enqueue(completed.identity)
    const transport = new Queue(REPORT_QUEUE_NAME, {
      connection: { host: "127.0.0.1", port: redis.port },
    })
    const bullJob = await transport.getJob(completed.identity.bullmqJobId)
    const counts = await context.database.pool.query<{
      readonly events: string
      readonly calls: string
      readonly results: string
    }>(
      `select
        (select count(*) from job_events where job_key = $1)::text events,
        (select count(*) from tool_calls where id = 'call_async_worker')::text calls,
        (select count(*) from jobs where ledger_key = $1 and result->>'reportId' = 'report_001')::text results`,
      [completed.identity.ledgerKey],
    )
    expect(bullJob?.id).toBe(completed.identity.bullmqJobId)
    expect(bullJob?.attemptsMade).toBe(2)
    expect(await transport.getJobCountByTypes("completed", "wait", "active", "failed")).toBe(1)
    expect(counts.rows[0]).toEqual({ events: "3", calls: "1", results: "1" })
    await transport.close()
    await worker.close()
    await queue.close()
  }, 30_000)
})
