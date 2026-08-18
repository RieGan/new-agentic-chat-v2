import {
  claimRunLease,
  completeReportJob,
  consumeSimpleLoopStep,
  createConversation,
  persistSimpleLoopUserWait,
  readApprovalSnapshot,
  readReportJob,
  readRunAssignment,
  recordReportProgress,
} from "@agentic-chat/db"
import { captureAcceptanceFromEnvironment } from "@agentic-chat/testkit"
import { createInvocationLedger, createToolRegistry } from "@agentic-chat/tools"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  createAdminCommandService,
  createAdmissionService,
  createApprovalService,
} from "../src/application/index.js"
import type { ReportJobQueue } from "../src/application/report-jobs.js"
import { createScriptedProvider } from "../src/provider/index.js"
import { SimpleLoopContextSchema } from "../src/simple-loop/context.js"
import { createSimpleLoopRuntime, createSimpleLoopWorker } from "../src/simple-loop/index.js"
import type { ApplicationTestContext } from "./application-support.js"
import {
  createTestIds,
  startApplicationTestContext,
  stopApplicationTestContext,
  testClock,
} from "./application-support.js"
import { readRunEvidence } from "./simple-loop-support.js"

class RecordingQueue implements ReportJobQueue {
  readonly payloads: Parameters<ReportJobQueue["enqueue"]>[0][] = []

  async enqueue(payload: Parameters<ReportJobQueue["enqueue"]>[0]): Promise<void> {
    this.payloads.push(payload)
  }
}

describe("Simple Loop durable waits", () => {
  let context: ApplicationTestContext

  beforeAll(async () => {
    context = await startApplicationTestContext()
  }, 60_000)

  afterAll(async () => {
    await stopApplicationTestContext(context)
  })

  it("resumes one report call with stable identities and remaining budget", async () => {
    // Given: F06 requests one deterministic report and the same provider survives the wait.
    const ids = createTestIds("wait-f06")
    await createConversation(context.database, {
      conversationId: "conversation_wait_f06",
      userId: "mvp_user",
      now: testClock.now(),
    })
    const receipt = await createAdmissionService({
      database: context.database,
      clock: testClock,
      ids,
    }).admit({
      commandId: "command_wait_f06",
      createdAt: testClock.now().toISOString(),
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_wait_f06",
        runtime: "simple_loop",
        message: "Generate the quarterly report.",
        idempotencyKey: "idempotency_wait_f06",
      },
    })
    const queue = new RecordingQueue()
    const ledger = createInvocationLedger()
    const runtime = createSimpleLoopRuntime({
      database: context.database,
      clock: testClock,
      ids,
      provider: createScriptedProvider([
        {
          kind: "skill_load",
          callId: "call_skill_wait_f06",
          skillId: "report_assistant",
          version: "1",
        },
        {
          kind: "tool_calls",
          calls: [
            {
              callId: "call_report_wait_f06",
              toolName: "report.generate",
              arguments: { topic: "quarterly", sections: ["summary"] },
            },
          ],
        },
      ]),
      tools: createToolRegistry({ ledger }),
      timeoutMs: 1_000,
      durableWaits: { namespace: "simple-loop-waits", reportQueue: queue },
    })

    // When: execution pauses, PostgreSQL completes the job, and a fresh owner resumes the run.
    const firstWorker = createSimpleLoopWorker(runtime, {
      owner: "worker_wait_f06_a",
      durationSeconds: 30,
    })
    const waiting = await firstWorker.execute(receipt.runId)
    const waitingEvidence = await readRunEvidence(context, receipt.runId)
    const job = await readReportJob(context.database, {
      namespace: "simple-loop-waits",
      runId: receipt.runId,
      jobId: "job_001",
    })
    if (!job) throw new TypeError("Expected durable report job")
    await recordReportProgress(context.database, {
      ledgerKey: job.identity.ledgerKey,
      eventId: "job_event_progress_wait_f06",
      runEventId: "run_event_progress_wait_f06",
      occurredAt: testClock.now(),
    })
    await completeReportJob(context.database, {
      ledgerKey: job.identity.ledgerKey,
      eventId: "job_event_complete_wait_f06",
      runEventId: "run_event_complete_wait_f06",
      reportId: "report_001",
      occurredAt: testClock.now(),
    })
    const restartedRuntime = createSimpleLoopRuntime({
      database: context.database,
      clock: testClock,
      ids,
      provider: createScriptedProvider([{ kind: "text", text: "Report report_001 is complete." }]),
      tools: createToolRegistry({ ledger }),
      timeoutMs: 1_000,
      durableWaits: { namespace: "simple-loop-waits", reportQueue: queue },
    })
    const restartedWorker = createSimpleLoopWorker(restartedRuntime, {
      owner: "worker_wait_f06_b",
      durationSeconds: 30,
    })
    const completed = await restartedWorker.execute(receipt.runId)
    const evidence = await readRunEvidence(context, receipt.runId)

    // Then: one job/result/final message exists and the new claim uses only the remaining step.
    expect(waiting).toMatchObject({
      status: "waiting_for_tool",
      consumedSteps: 2,
      wait: { callId: "call_report_wait_f06", jobId: "job_001" },
    })
    expect(completed).toMatchObject({
      status: "completed",
      text: "Report report_001 is complete.",
      consumedSteps: 3,
    })
    expect(queue.payloads).toHaveLength(1)
    expect(queue.payloads[0]).toMatchObject({
      runId: receipt.runId,
      callId: "call_report_wait_f06",
      jobId: "job_001",
      reportId: "report_001",
    })
    expect(evidence.calls).toHaveLength(1)
    expect(evidence.calls[0]).toMatchObject({ tool_id: "report.generate", status: "completed" })
    expect(evidence.messages.filter((message) => message.actor === "ai")).toHaveLength(1)
    expect(waitingEvidence.run).toMatchObject({ lease_owner: null, fencing_version: 1 })
    expect(evidence.run).toMatchObject({ lease_owner: null, fencing_version: 2 })
    expect(firstWorker.inspect()).toEqual({ runtime: "simple_loop", claims: 1 })
    expect(restartedWorker.inspect()).toEqual({ runtime: "simple_loop", claims: 1 })
    await expect(
      restartedRuntime.execute({
        runId: receipt.runId,
        owner: "worker_wait_f06_duplicate",
        durationSeconds: 30,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await captureAcceptanceFromEnvironment(context.database, {
      runId: receipt.runId,
      fixtureNamespace: "wait-f06",
      runtimeDiagnostics: [
        { waiting, firstWorker: firstWorker.inspect(), restartedWorker: restartedWorker.inspect() },
      ],
      executionOutcome: completed,
    })
  })

  it.each([
    {
      decision: "approve" as const,
      expectedSends: 1,
      finalText: "Message message_call_send_wait was sent.",
    },
    { decision: "reject" as const, expectedSends: 0, finalText: "The message was not sent." },
  ])(
    "resumes an exact approval once after $decision",
    async ({ decision, expectedSends, finalText }) => {
      // Given: F07/F08 reaches one approval-bound send after a durable preview.
      const namespace = `wait-${decision}`
      const ids = createTestIds(namespace)
      await createConversation(context.database, {
        conversationId: `conversation_${namespace}`,
        userId: "mvp_user",
        now: testClock.now(),
      })
      const receipt = await createAdmissionService({
        database: context.database,
        clock: testClock,
        ids,
      }).admit({
        commandId: `command_${namespace}`,
        createdAt: testClock.now().toISOString(),
        type: "chat.send_message",
        actorId: "mvp_user",
        payload: {
          kind: "new_run",
          conversationId: `conversation_${namespace}`,
          runtime: "simple_loop",
          message: "Preview and send the notification.",
          idempotencyKey: `idempotency_${namespace}`,
        },
      })
      const ledger = createInvocationLedger()
      const tools = createToolRegistry({ ledger })
      const firstRuntime = createSimpleLoopRuntime({
        database: context.database,
        clock: testClock,
        ids,
        provider: createScriptedProvider([
          {
            kind: "skill_load",
            callId: `call_skill_${namespace}`,
            skillId: "communication_assistant",
            version: "1",
          },
          {
            kind: "tool_calls",
            calls: [
              {
                callId: `call_preview_${namespace}`,
                toolName: "notification.preview",
                arguments: { recipient: "qa@example.com", subject: "MVP", body: "Approval" },
              },
            ],
          },
          {
            kind: "tool_calls",
            calls: [
              {
                callId: `call_send_${namespace}`,
                toolName: "notification.send_email",
                arguments: { previewId: `preview_call_preview_${namespace}` },
              },
            ],
          },
        ]),
        tools,
        timeoutMs: 1_000,
        durableWaits: { namespace, reportQueue: new RecordingQueue() },
      })
      const waiting = await firstRuntime.execute({
        runId: receipt.runId,
        owner: `worker_${namespace}_before`,
        durationSeconds: 30,
      })
      if (waiting.status !== "waiting_for_admin" || waiting.wait.approvalId === undefined) {
        throw new TypeError("Expected approval wait")
      }
      const approval = await readApprovalSnapshot(context.database, {
        runId: receipt.runId,
        approvalId: waiting.wait.approvalId,
        callId: waiting.wait.callId ?? "",
      })
      if (!approval) throw new TypeError("Expected approval snapshot")

      // When: Admin decides and an independently constructed worker resumes the durable binding.
      const approvalService = createApprovalService({
        database: context.database,
        clock: testClock,
        ids,
        tools,
      })
      await approvalService.decide(
        { actorId: "mvp_admin" },
        {
          decision,
          approvalId: approval.approvalId,
          callId: approval.callId,
          expectedArgumentsHash: approval.argumentsHash,
          expectedVersion: approval.version,
          ...(decision === "reject" ? { reason: "MVP rejection test" } : {}),
        },
      )
      const restartedRuntime = createSimpleLoopRuntime({
        database: context.database,
        clock: testClock,
        ids,
        provider: createScriptedProvider([{ kind: "text", text: finalText }]),
        tools,
        timeoutMs: 1_000,
        durableWaits: { namespace, reportQueue: new RecordingQueue() },
      })
      const completed = await restartedRuntime.execute({
        runId: receipt.runId,
        owner: `worker_${namespace}_after`,
        durationSeconds: 30,
      })
      const evidence = await readRunEvidence(context, receipt.runId)

      // Then: the immutable call/approval survives restart and only approval can produce one send.
      expect(completed).toMatchObject({ status: "completed", text: finalText, consumedSteps: 4 })
      expect(ledger.executionCount("notification.send_email")).toBe(expectedSends)
      expect(
        evidence.calls.filter((call) => call.tool_id === "notification.send_email"),
      ).toHaveLength(1)
      expect(evidence.messages.filter((message) => message.actor === "ai")).toHaveLength(1)
      const selectedPrompt = decision === "approve" ? "P08" : "P09"
      if (process.env["ACCEPTANCE_CAPTURE_PROMPT"] === selectedPrompt) {
        await captureAcceptanceFromEnvironment(context.database, {
          runId: receipt.runId,
          fixtureNamespace: namespace,
          runtimeDiagnostics: [
            {
              waiting,
              decision,
              simulatedSends: ledger.executionCount("notification.send_email"),
            },
          ],
          executionOutcome: completed,
        })
      }
    },
  )

  it("applies hidden Admin guidance once before same-run User continuation", async () => {
    // Given: F09 has one safely paused run, one hidden command, and the frozen continuation correlation.
    const ids = createTestIds("wait-admin")
    const admission = createAdmissionService({ database: context.database, clock: testClock, ids })
    await createConversation(context.database, {
      conversationId: "conversation_wait_admin",
      userId: "mvp_user",
      now: testClock.now(),
    })
    const receipt = await admission.admit({
      commandId: "command_wait_admin",
      createdAt: testClock.now().toISOString(),
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "new_run",
        conversationId: "conversation_wait_admin",
        runtime: "simple_loop",
        message: "Wait for guidance.",
        idempotencyKey: "idempotency_wait_admin",
      },
    })
    const assignment = await readRunAssignment(context.database, receipt.runId)
    const lease = await claimRunLease(context.database, {
      runId: receipt.runId,
      runtime: "simple_loop",
      owner: "worker_wait_admin_seed",
      expectedVersion: assignment.version,
      durationSeconds: 30,
    })
    const correlationId = "correlation_wait_admin"
    const waitingContext = z.json().parse(
      SimpleLoopContextSchema.parse({
        kind: "simple_loop",
        consumedSteps: 1,
        messages: [{ role: "user", content: "Wait for guidance." }],
        wait: { kind: "user", correlationId },
      }),
    )
    const running = await consumeSimpleLoopStep(context.database, {
      runId: receipt.runId,
      owner: "worker_wait_admin_seed",
      fencingVersion: lease.fencingVersion,
      expectedVersion: lease.version,
      occurredAt: testClock.now(),
      eventId: "event_wait_admin_running",
      correlationId,
      context: waitingContext,
    })
    await persistSimpleLoopUserWait(context.database, {
      runId: receipt.runId,
      owner: "worker_wait_admin_seed",
      fencingVersion: lease.fencingVersion,
      expectedVersion: running.version,
      occurredAt: testClock.now(),
      eventId: "event_wait_admin_seed",
      statusEventId: "event_wait_admin_status",
      correlationId,
      context: waitingContext,
    })
    const instruction = "Return the fixed ADMIN_GUIDANCE_OK token."
    const admin = createAdminCommandService({ database: context.database, clock: testClock, ids })
    const command = await admin.submit(
      { actorId: "mvp_admin" },
      {
        conversationId: "conversation_wait_admin",
        instruction,
        expiresAt: "2026-08-17T13:00:00.000Z",
        idempotencyKey: "admin_wait_command",
      },
    )
    await admission.admit({
      commandId: "command_wait_admin_continue",
      createdAt: testClock.now().toISOString(),
      type: "chat.send_message",
      actorId: "mvp_user",
      payload: {
        kind: "continue_run",
        conversationId: "conversation_wait_admin",
        runId: receipt.runId,
        boundary: "waiting_for_user",
        correlationId,
        message: "Respond now.",
        idempotencyKey: "idempotency_wait_admin_continue",
      },
    })
    let providerMessages: unknown
    const scripted = createScriptedProvider([{ kind: "text", text: "ADMIN_GUIDANCE_OK" }])
    const provider = {
      generate: async (input: unknown) => {
        providerMessages = input
        return scripted.generate(input)
      },
    }

    // When: the same run resumes and crosses its next before_model boundary.
    const completed = await createSimpleLoopRuntime({
      database: context.database,
      clock: testClock,
      ids,
      provider,
      tools: createToolRegistry(),
      timeoutMs: 1_000,
    }).execute({ runId: receipt.runId, owner: "worker_wait_admin_resume", durationSeconds: 30 })
    const evidence = await readRunEvidence(context, receipt.runId)
    const storedCommand = await context.database.pool.query<{ readonly status: string }>(
      "select status from admin_commands where id = $1",
      [command.commandId],
    )

    // Then: guidance affects one model call, raw content stays out of User records, and identity is unchanged.
    expect(providerMessages).toMatchObject({
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: "Wait for guidance." },
        { role: "user", content: "Respond now." },
      ],
    })
    expect(completed).toMatchObject({
      runId: receipt.runId,
      status: "completed",
      text: "ADMIN_GUIDANCE_OK",
    })
    expect(storedCommand.rows).toEqual([{ status: "applied" }])
    expect(JSON.stringify({ events: evidence.events, messages: evidence.messages })).not.toContain(
      instruction,
    )
    await captureAcceptanceFromEnvironment(context.database, {
      runId: receipt.runId,
      fixtureNamespace: "wait-admin",
      runtimeDiagnostics: [{ commandStatus: storedCommand.rows[0]?.status ?? "missing" }],
      executionOutcome: completed,
    })
  })
})
