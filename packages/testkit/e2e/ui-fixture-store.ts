import {
  type ApprovalEnvelope,
  ApprovalEnvelopeSchema,
  type CanonicalEvent,
  CanonicalEventSchema,
  ChatSendMessageInputSchema,
  CommandAcceptedOutputSchema,
  type RunSnapshot,
  RunSnapshotSchema,
} from "@agentic-chat/contracts"
import type { ApiServices } from "../../../apps/api/src/services.js"

export const FIXTURE_NOW = "2026-08-17T12:00:00.000Z"

export class UiFixtureStore {
  readonly eventsByRun = new Map<string, CanonicalEvent[]>()
  readonly runs = new Map<string, RunSnapshot>()
  readonly messages: Array<{
    readonly messageId: string
    readonly runId: string
    readonly actor: "user" | "ai"
    readonly content: string
    readonly createdAt: string
  }> = []
  readonly approvals = new Map<string, ApprovalEnvelope>()
  readonly staleReads = new Set<string>()
  private counter = 0

  constructor() {
    this.seedRun("run_seed_admin")
    this.seedRun("run_race_slow")
    this.seedRun("run_race_fast")
    for (const id of ["approval_fixture_approve", "approval_fixture_reject"]) {
      this.approvals.set(id, this.seedApproval(id, "run_seed_admin"))
    }
  }

  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}_${this.counter}`
  }

  append(runId: string, candidate: unknown): CanonicalEvent {
    const current = this.eventsByRun.get(runId) ?? []
    const sequence = current.length + 1
    const event = CanonicalEventSchema.parse({
      eventId: `event_${runId}_${sequence}`,
      runId,
      sequence,
      occurredAt: FIXTURE_NOW,
      correlationId: `correlation_${runId}`,
      ...Object(candidate),
    })
    this.eventsByRun.set(runId, [...current, event])
    const run = this.runs.get(runId)
    if (run !== undefined) {
      this.runs.set(runId, RunSnapshotSchema.parse({ ...run, cursor: { runId, sequence } }))
    }
    return event
  }

  setStatus(runId: string, status: RunSnapshot["status"]): void {
    const run = this.runs.get(runId)
    if (run === undefined) throw new TypeError("Fixture run missing")
    this.runs.set(runId, RunSnapshotSchema.parse({ ...run, status, version: run.version + 1 }))
  }

  complete(runId: string, text: string): void {
    const run = this.runs.get(runId)
    if (run === undefined) return
    this.append(runId, {
      type: "message.completed",
      visibility: "user",
      payload: { messageId: `message_ai_${runId}`, actor: "ai", content: text },
    })
    this.messages.push({
      messageId: `message_ai_${runId}`,
      runId,
      actor: "ai",
      content: text,
      createdAt: FIXTURE_NOW,
    })
    this.append(runId, {
      type: "run.status_changed",
      visibility: "user",
      payload: { previous: run.status, current: "completed" },
    })
    this.setStatus(runId, "completed")
  }

  seedApproval(id: string, runId: string): ApprovalEnvelope {
    return ApprovalEnvelopeSchema.parse({
      approvalId: id,
      runId,
      callId: `call_${id}`,
      toolName: "notification.send_email",
      arguments: { previewId: `preview_${id}` },
      argumentsHash: `sha256:${id}:exact`,
      requiredActor: "mvp_admin",
      expiresAt: "2026-08-17T12:05:00.000Z",
      version: 0,
      status: "pending",
    })
  }

  private seedRun(runId: string): void {
    this.runs.set(
      runId,
      RunSnapshotSchema.parse({
        runId,
        conversationId: "conversation_ui_mvp",
        runtime: "simple_loop",
        status: "running",
        version: 0,
        consumedSteps: 1,
        cursor: { runId, sequence: 0 },
      }),
    )
    this.eventsByRun.set(runId, [])
  }

  readonly sendMessage: ApiServices["sendMessage"] = async (unparsed) => {
    const input = ChatSendMessageInputSchema.parse(unparsed)
    const invocation = this.nextId("invocation")
    const runId =
      input.kind === "continue_run" ? input.runId : `run_ui_${input.runtime}_${invocation}`
    if (input.kind === "new_run") {
      this.runs.set(
        runId,
        RunSnapshotSchema.parse({
          runId,
          conversationId: input.conversationId,
          runtime: input.runtime,
          status: "queued",
          version: 0,
          consumedSteps: 1,
          cursor: { runId, sequence: 0 },
        }),
      )
      this.eventsByRun.set(runId, [])
    }
    const messageId = `message_user_${runId}_${invocation}`
    this.messages.push({
      messageId,
      runId,
      actor: "user",
      content: input.message,
      createdAt: FIXTURE_NOW,
    })
    this.append(runId, {
      type: "message.completed",
      visibility: "user",
      payload: { messageId, actor: "user", content: input.message },
    })
    this.append(runId, {
      type: "run.status_changed",
      visibility: "user",
      payload: {
        previous: input.kind === "new_run" ? "queued" : "waiting_for_user",
        current: "running",
      },
    })
    this.setStatus(runId, "running")
    if (input.message.includes("stale")) this.staleReads.add(runId)
    this.scheduleOutcome(runId, input.message, invocation)
    return CommandAcceptedOutputSchema.parse({
      commandId: `command_${invocation}`,
      status: "accepted",
      runId,
    })
  }

  private scheduleOutcome(runId: string, message: string, invocation: string): void {
    if (message.includes("report")) {
      setTimeout(() => {
        this.append(runId, {
          type: "tool.call.started",
          visibility: "user",
          payload: { callId: `call_${runId}`, toolName: "report.generate" },
        })
        this.append(runId, {
          type: "job.accepted",
          visibility: "user",
          payload: { jobId: `job_${runId}`, callId: `call_${runId}`, status: "queued" },
        })
        this.append(runId, {
          type: "job.progress",
          visibility: "user",
          payload: {
            jobId: `job_${runId}`,
            callId: `call_${runId}`,
            status: "running",
            percent: 50,
          },
        })
      }, 30)
      setTimeout(() => {
        this.append(runId, {
          type: "job.completed",
          visibility: "user",
          payload: {
            jobId: `job_${runId}`,
            callId: `call_${runId}`,
            status: "completed",
            reportId: `report_${runId}`,
          },
        })
        this.complete(
          runId,
          `Report completed on ${this.runs.get(runId)?.runtime.replaceAll("_", " ")}.`,
        )
      }, 80)
      return
    }
    if (message.includes("approval")) {
      setTimeout(() => {
        const approval = this.seedApproval(`approval_${invocation}`, runId)
        this.approvals.set(approval.approvalId, approval)
        this.append(runId, {
          type: "tool.call.approval_required",
          visibility: "user",
          payload: {
            callId: approval.callId,
            toolName: approval.toolName,
            approvalId: approval.approvalId,
          },
        })
        this.append(runId, {
          type: "approval.requested",
          visibility: "admin",
          payload: {
            approvalId: approval.approvalId,
            callId: approval.callId,
            toolName: approval.toolName,
            argumentsHash: approval.argumentsHash,
            expiresAt: approval.expiresAt,
          },
        })
        this.append(runId, {
          type: "run.status_changed",
          visibility: "user",
          payload: { previous: "running", current: "waiting_for_admin" },
        })
        this.setStatus(runId, "waiting_for_admin")
      }, 30)
      return
    }
    setTimeout(
      () =>
        this.complete(
          runId,
          `Direct answer from ${this.runs.get(runId)?.runtime.replaceAll("_", " ")}: ${message}.`,
        ),
      45,
    )
  }
}
