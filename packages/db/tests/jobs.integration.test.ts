import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  admitReportJob,
  completeReportJob,
  listReportJobEvents,
  readReportJob,
  recordReportProgress,
} from "../src/index.js"
import {
  insertRunFixture,
  migrateAndSeed,
  startTestContext,
  stopTestContext,
  type TestContext,
} from "./support.js"

describe("durable report job schema", () => {
  let context: TestContext

  beforeAll(async () => {
    context = await startTestContext()
    await migrateAndSeed(context)
  }, 60_000)

  afterAll(async () => {
    await stopTestContext(context)
  })

  it("stores the fixture job identity independently for each namespace and run", async () => {
    // Given: two report calls use the same public fixture job ID.
    await insertRunFixture(context, "run_job_scope_a")
    await insertRunFixture(context, "run_job_scope_b")
    await context.database.pool.query(
      `insert into tool_calls
        (id, run_id, tool_id, tool_version, arguments, arguments_hash)
       values
        ('call_job_scope_a', 'run_job_scope_a', 'report.generate', '1', '{"topic":"a","sections":["one"]}'::jsonb, 'hash-a'),
        ('call_job_scope_b', 'run_job_scope_b', 'report.generate', '1', '{"topic":"b","sections":["two"]}'::jsonb, 'hash-b')`,
    )

    // When: both scoped ledger records are inserted.
    await context.database.pool.query(
      `insert into jobs
        (ledger_key, namespace, id, run_id, call_id, bullmq_job_id, workflow_identity)
       values
        ('ledger-a', 'suite-a', 'job_001', 'run_job_scope_a', 'call_job_scope_a', 'report-a', 'bullmq/report-a'),
        ('ledger-b', 'suite-b', 'job_001', 'run_job_scope_b', 'call_job_scope_b', 'report-b', 'bullmq/report-b')`,
    )

    // Then: PostgreSQL retains two logical jobs with the same public fixture identity.
    const stored = await context.database.pool.query<{
      readonly count: string
      readonly job_ids: string[]
    }>(
      `select count(*)::text count, array_agg(id order by ledger_key) job_ids
       from jobs where id = 'job_001'`,
    )
    expect(stored.rows[0]).toEqual({ count: "2", job_ids: ["job_001", "job_001"] })
  })

  it("durably accepts one logical report job when admission is delivered twice", async () => {
    // Given: a running report call with deterministic application and BullMQ identities.
    await insertRunFixture(context, "run_report_admission")
    const input = {
      namespace: "async-job-admission",
      ledgerKey: "report-ledger-admission",
      runId: "run_report_admission",
      callId: "call_report_admission",
      jobId: "job_001",
      reportId: "report_001",
      bullmqJobId: "report-admission",
      arguments: { topic: "quarterly", sections: ["summary"] },
      argumentsHash: "report-arguments-hash",
      acceptedEventId: "job_event_admission_accepted",
      runEventId: "run_event_admission_accepted",
      dispatchId: "dispatch_report_admission",
      occurredAt: new Date("2026-08-16T12:00:00.000Z"),
    } as const

    // When: the same admission is retried.
    const accepted = await admitReportJob(context.database, input)
    const replayed = await admitReportJob(context.database, input)

    // Then: the canonical queued snapshot is replayed and each durable record exists once.
    expect(accepted).toEqual(replayed)
    expect(accepted).toMatchObject({ status: "queued", percent: 0, version: 0 })
    const counts = await context.database.pool.query<{
      readonly jobs: string
      readonly calls: string
      readonly job_events: string
      readonly run_events: string
      readonly intents: string
    }>(
      `select
        (select count(*) from jobs where ledger_key = 'report-ledger-admission')::text jobs,
        (select count(*) from tool_calls where id = 'call_report_admission')::text calls,
        (select count(*) from job_events where job_key = 'report-ledger-admission')::text job_events,
        (select count(*) from run_events where run_id = 'run_report_admission')::text run_events,
        (select count(*) from dispatch_intents where aggregate_id = 'report-ledger-admission')::text intents`,
    )
    expect(counts.rows[0]).toEqual({
      jobs: "1",
      calls: "1",
      job_events: "1",
      run_events: "1",
      intents: "1",
    })
    await expect(
      admitReportJob(context.database, {
        ...input,
        arguments: { topic: "changed", sections: ["different"] },
        argumentsHash: "different-report-arguments-hash",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })

  it("persists progress and completion once across redelivery", async () => {
    // Given: an accepted report job whose first worker delivery reaches durable progress.
    await insertRunFixture(context, "run_report_lifecycle")
    const accepted = await admitReportJob(context.database, {
      namespace: "async-job-lifecycle",
      ledgerKey: "report-ledger-lifecycle",
      runId: "run_report_lifecycle",
      callId: "call_report_lifecycle",
      jobId: "job_001",
      reportId: "report_001",
      bullmqJobId: "report-lifecycle",
      arguments: { topic: "quarterly", sections: ["summary"] },
      argumentsHash: "report-lifecycle-hash",
      acceptedEventId: "job_event_lifecycle_accepted",
      runEventId: "run_event_lifecycle_accepted",
      dispatchId: "dispatch_report_lifecycle",
      occurredAt: new Date("2026-08-16T12:00:00.000Z"),
    })
    const progressInput = {
      ledgerKey: accepted.identity.ledgerKey,
      eventId: "job_event_lifecycle_progress",
      runEventId: "run_event_lifecycle_progress",
      occurredAt: new Date("2026-08-16T12:00:01.000Z"),
    } as const
    await recordReportProgress(context.database, progressInput)

    // When: progress and completion are delivered again after the worker retries.
    const replayedProgress = await recordReportProgress(context.database, progressInput)
    const completionInput = {
      ledgerKey: accepted.identity.ledgerKey,
      reportId: "report_001",
      eventId: "job_event_lifecycle_completed",
      runEventId: "run_event_lifecycle_completed",
      occurredAt: new Date("2026-08-16T12:00:02.000Z"),
    } as const
    const completed = await completeReportJob(context.database, completionInput)
    const replayedCompletion = await completeReportJob(context.database, completionInput)

    // Then: PostgreSQL exposes one 50% event, one result, and one completed tool call.
    expect(replayedProgress).toMatchObject({ status: "running", percent: 50, version: 1 })
    expect(completed).toEqual(replayedCompletion)
    expect(completed).toMatchObject({
      status: "completed",
      percent: 100,
      reportId: "report_001",
      version: 2,
    })
    await expect(
      readReportJob(context.database, {
        namespace: "async-job-lifecycle",
        runId: "run_report_lifecycle",
        jobId: "job_001",
      }),
    ).resolves.toEqual(completed)
    const durable = await context.database.pool.query<{
      readonly job_events: string
      readonly progress_events: string
      readonly completion_events: string
      readonly completed_calls: string
    }>(
      `select
        (select count(*) from job_events where job_key = 'report-ledger-lifecycle')::text job_events,
        (select count(*) from job_events where job_key = 'report-ledger-lifecycle' and type = 'job.progress')::text progress_events,
        (select count(*) from job_events where job_key = 'report-ledger-lifecycle' and type = 'job.completed')::text completion_events,
        (select count(*) from tool_calls where id = 'call_report_lifecycle' and status = 'completed' and result->>'reportId' = 'report_001')::text completed_calls`,
    )
    expect(durable.rows[0]).toEqual({
      job_events: "3",
      progress_events: "1",
      completion_events: "1",
      completed_calls: "1",
    })
    await expect(
      listReportJobEvents(context.database, {
        namespace: "async-job-lifecycle",
        runId: "run_report_lifecycle",
        jobId: "job_001",
      }),
    ).resolves.toMatchObject([
      { sequence: 1, type: "job.accepted", payload: { status: "queued" } },
      { sequence: 2, type: "job.progress", payload: { status: "running", percent: 50 } },
      {
        sequence: 3,
        type: "job.completed",
        payload: { status: "completed", reportId: "report_001" },
      },
    ])
    await context.database.pool.query(
      "update jobs set result = '{\"unexpected\":true}'::jsonb where ledger_key = 'report-ledger-lifecycle'",
    )
    await expect(
      readReportJob(context.database, {
        namespace: "async-job-lifecycle",
        runId: "run_report_lifecycle",
        jobId: "job_001",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCHEMA" })
  })

  it("dispatches a waiting Simple Loop run only after report completion", async () => {
    // Given: a Simple Loop report call is durably waiting while the job reports progress.
    await insertRunFixture(context, "run_report_resume")
    const accepted = await admitReportJob(context.database, {
      namespace: "simple-loop-resume",
      ledgerKey: "report-ledger-resume",
      runId: "run_report_resume",
      callId: "call_report_resume",
      jobId: "job_001",
      reportId: "report_001",
      bullmqJobId: "report-resume",
      arguments: { topic: "quarterly", sections: ["summary"] },
      argumentsHash: "report-resume-hash",
      acceptedEventId: "job_event_resume_accepted",
      runEventId: "run_event_resume_accepted",
      dispatchId: "dispatch_report_resume",
      occurredAt: new Date("2026-08-16T12:00:00.000Z"),
    })
    await context.database.pool.query(
      "update runs set status = 'waiting_for_tool' where id = 'run_report_resume'",
    )

    // When: progress arrives before the canonical report result, then completion follows.
    await recordReportProgress(context.database, {
      ledgerKey: accepted.identity.ledgerKey,
      eventId: "job_event_resume_progress",
      runEventId: "run_event_resume_progress",
      occurredAt: new Date("2026-08-16T12:00:01.000Z"),
    })
    const progressDispatches = await context.database.pool.query<{ readonly count: string }>(
      "select count(*)::text count from dispatch_intents where aggregate_id = 'run_report_resume' and topic = 'simple_loop.execute'",
    )
    await completeReportJob(context.database, {
      ledgerKey: accepted.identity.ledgerKey,
      eventId: "job_event_resume_completed",
      runEventId: "run_event_resume_completed",
      reportId: "report_001",
      occurredAt: new Date("2026-08-16T12:00:02.000Z"),
    })
    const completionDispatches = await context.database.pool.query<{ readonly count: string }>(
      "select count(*)::text count from dispatch_intents where aggregate_id = 'run_report_resume' and topic = 'simple_loop.execute'",
    )

    // Then: no premature poll can consume the one completion-triggered resume intent.
    expect(progressDispatches.rows[0]?.count).toBe("0")
    expect(completionDispatches.rows[0]?.count).toBe("1")
  })
})
