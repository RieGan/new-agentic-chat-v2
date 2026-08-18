import {
  AdminCommandEnvelopeSchema,
  AdminCommandInputSchema,
  ApprovalEnvelopeSchema,
  ApprovalGetInputSchema,
  ApprovalListPendingInputSchema,
  ConversationCreateInputSchema,
  ConversationGetInputSchema,
  ConversationProjectionSchema,
  ConversationsListInputSchema,
  ConversationsListOutputSchema,
  RunEventsInputSchema,
  RunGetInputSchema,
  RunsListInputSchema,
  type SnapshotCursor,
} from "@agentic-chat/contracts"
import { CursorInvalidatedError, decodeTrackedCursor } from "../../../apps/api/src/events/cursor.js"
import type { ApiServices } from "../../../apps/api/src/services.js"
import { FIXTURE_NOW, UiFixtureStore } from "./ui-fixture-store.js"

export const createUiFixtureServices = (): ApiServices => {
  const store = new UiFixtureStore()
  return {
    async createConversation(unparsed: unknown) {
      const input = ConversationCreateInputSchema.parse(unparsed)
      return store.createConversation(input.conversationId)
    },
    async listConversations(unparsed: unknown) {
      ConversationsListInputSchema.parse(unparsed)
      return ConversationsListOutputSchema.parse({
        conversations: [...store.conversations.values()].reverse(),
      })
    },
    sendMessage: store.sendMessage,
    async sendHidden(unparsed: unknown) {
      const input = AdminCommandInputSchema.parse(unparsed)
      if (!store.conversations.has(input.conversationId)) {
        throw new TypeError("Fixture conversation missing")
      }
      const commandId = store.nextId("admin_command")
      if (input.instruction === "CREATE_APPROVAL_FIXTURE_EVENT") {
        const run = [...store.runs.values()].findLast(
          (candidate) => candidate.conversationId === input.conversationId,
        )
        if (run === undefined) throw new TypeError("Fixture conversation run missing")
        const approval = store.seedApproval(store.nextId("approval_discovery"), run.runId)
        store.approvals.set(approval.approvalId, approval)
        store.append(run.runId, {
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
      }
      return AdminCommandEnvelopeSchema.parse({
        ...input,
        commandId,
        actorId: "mvp_admin",
        visibility: "model_only",
        version: 0,
        status: "accepted",
      })
    },
    async decideApproval(input) {
      const current = store.approvals.get(input.approvalId)
      if (current === undefined) throw new TypeError("Fixture approval missing")
      const next = ApprovalEnvelopeSchema.parse({
        ...current,
        status: input.decision === "approve" ? "approved" : "rejected",
        decidedBy: "mvp_admin",
        decidedAt: FIXTURE_NOW,
        ...(input.decision === "reject" ? { reason: input.reason } : {}),
      })
      store.approvals.set(next.approvalId, next)
      store.append(next.runId, {
        type: input.decision === "approve" ? "approval.approved" : "approval.rejected",
        visibility: "admin",
        payload: {
          approvalId: next.approvalId,
          callId: next.callId,
          actorId: "mvp_admin",
          ...(input.decision === "reject" ? { reason: input.reason } : {}),
        },
      })
      return next
    },
    async conversation(unparsed: unknown) {
      const input = ConversationGetInputSchema.parse(unparsed)
      return ConversationProjectionSchema.parse({
        conversationId: input.conversationId,
        messages: store.messages
          .filter((message) => message.conversationId === input.conversationId)
          .map((message) => ({
            messageId: message.messageId,
            runId: message.runId,
            actor: message.actor,
            content: message.content,
            createdAt: message.createdAt,
          })),
        runs: [...store.runs.values()].filter((run) => run.conversationId === input.conversationId),
      })
    },
    async listRuns(unparsed: unknown) {
      const input = RunsListInputSchema.parse(unparsed)
      return [...store.runs.values()].filter(
        (run) =>
          (input.runtime === undefined || run.runtime === input.runtime) &&
          (input.status === undefined || run.status === input.status),
      )
    },
    async run(viewer, unparsed: unknown) {
      const input = RunGetInputSchema.parse(unparsed)
      const run = store.runs.get(input.runId)
      if (run === undefined) throw new TypeError("Fixture run missing")
      const stale = viewer === "user" && store.staleReads.delete(input.runId)
      return {
        viewer,
        run: stale ? { ...run, cursor: { runId: run.runId, sequence: 99 } } : run,
        events: (store.eventsByRun.get(input.runId) ?? []).filter(
          (event) => viewer === "admin" || event.visibility === "user",
        ),
      }
    },
    async events(viewer, unparsed: unknown) {
      const input = RunEventsInputSchema.parse(unparsed)
      const run = store.runs.get(input.runId)
      if (run === undefined) throw new TypeError("Fixture run missing")
      return {
        cursor: run.cursor,
        events: (store.eventsByRun.get(input.runId) ?? []).filter(
          (event) =>
            event.sequence > (input.afterSequence ?? 0) &&
            (viewer === "admin" || event.visibility === "user"),
        ),
      }
    },
    async listPendingApprovals(unparsed: unknown) {
      const input = ApprovalListPendingInputSchema.parse(unparsed)
      return [...store.approvals.values()].filter(
        (approval) =>
          approval.status === "pending" &&
          (input.runId === undefined || approval.runId === input.runId),
      )
    },
    async approval(unparsed: unknown) {
      const input = ApprovalGetInputSchema.parse(unparsed)
      const value = store.approvals.get(input.approvalId)
      if (value === undefined) throw new TypeError("Fixture approval missing")
      return value
    },
    async job() {
      throw new TypeError("Fixture job lookup is not used")
    },
    async skill() {
      throw new TypeError("Fixture skill lookup is not used")
    },
    async resolveCursor(
      runId: SnapshotCursor["runId"],
      cursor: SnapshotCursor | undefined,
      lastEventId: string | undefined,
    ) {
      const selected = lastEventId === undefined ? cursor : decodeTrackedCursor(lastEventId)
      const candidate = selected ?? { runId, sequence: 0 }
      const current = store.eventsByRun.get(runId) ?? []
      if (candidate.runId !== runId || candidate.sequence > current.length) {
        throw new CursorInvalidatedError()
      }
      return candidate
    },
  }
}
