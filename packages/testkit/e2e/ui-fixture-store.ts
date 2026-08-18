import {
  type ApprovalEnvelope,
  ApprovalEnvelopeSchema,
  type CanonicalEvent,
  CanonicalEventSchema,
  ChatSendMessageInputSchema,
  CommandAcceptedOutputSchema,
  ConversationSummarySchema,
  type RunSnapshot,
  RunSnapshotSchema,
} from "@agentic-chat/contracts"
import type { ApiServices } from "../../../apps/api/src/services.js"
import { scheduleFixtureOutcome } from "./ui-fixture-outcomes.js"

export const FIXTURE_NOW = "2026-08-17T12:00:00.000Z"

type ConversationSummary = ReturnType<(typeof ConversationSummarySchema)["parse"]>

export class UiFixtureStore {
  readonly eventsByRun = new Map<string, CanonicalEvent[]>()
  readonly runs = new Map<string, RunSnapshot>()
  readonly conversations = new Map<string, ConversationSummary>()
  readonly messages: Array<{
    readonly messageId: string
    readonly runId: string
    readonly conversationId: string
    readonly actor: "user" | "ai"
    readonly content: string
    readonly createdAt: string
  }> = []
  readonly approvals = new Map<string, ApprovalEnvelope>()
  readonly staleReads = new Set<string>()
  private counter = 0

  constructor() {
    this.seedRun("run_seed_admin", "conversation_admin_seed", "running")
    this.seedRun("run_race_slow", "conversation_race_slow", "running")
    this.seedRun("run_race_fast", "conversation_race_fast", "running")
    this.seedRun("run_terminal", "conversation_terminal", "completed")
    this.createConversation("conversation_admin_idle")
    for (const id of ["approval_fixture_approve", "approval_fixture_reject"]) {
      this.approvals.set(id, this.seedApproval(id, "run_seed_admin"))
    }
  }

  nextId(prefix: string): string {
    this.counter += 1
    return `${prefix}_${this.counter}`
  }

  createConversation(conversationId: string): ConversationSummary {
    const created = ConversationSummarySchema.parse({
      conversationId,
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    })
    this.conversations.set(conversationId, created)
    return created
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
      conversationId: run.conversationId,
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

  private seedRun(runId: string, conversationId: string, status: RunSnapshot["status"]): void {
    this.createConversation(conversationId)
    this.runs.set(
      runId,
      RunSnapshotSchema.parse({
        runId,
        conversationId,
        runtime: "simple_loop",
        status,
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
      conversationId: input.conversationId,
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
    scheduleFixtureOutcome({ store: this, runId, message: input.message, invocation })
    return CommandAcceptedOutputSchema.parse({
      commandId: `command_${invocation}`,
      status: "accepted",
      runId,
    })
  }
}
