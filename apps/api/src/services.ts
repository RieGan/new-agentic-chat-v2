import {
  type ApprovalDecisionInput,
  type ChatSendMessageInput,
  ConversationCreateInputSchema,
  ConversationSummarySchema,
  ConversationsListInputSchema,
  ConversationsListOutputSchema,
  parseContract,
  type SnapshotCursor,
} from "@agentic-chat/contracts"
import {
  createConversation as createConversationRecord,
  type DatabaseClient,
  listConversations as listConversationRecords,
} from "@agentic-chat/db"
import {
  type Clock,
  createAdminCommandService,
  createAdmissionService,
  createApiQueryService,
  createApprovalService,
  type IdGenerator,
} from "@agentic-chat/runtime"
import type { ToolRegistry } from "@agentic-chat/tools"

import { CursorInvalidatedError, decodeTrackedCursor } from "./events/cursor.js"

export type ApiServiceDependencies = {
  readonly database: DatabaseClient
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly tools: ToolRegistry
}

export const createApiServices = (dependencies: ApiServiceDependencies) => {
  const admission = createAdmissionService(dependencies)
  const adminCommands = createAdminCommandService(dependencies)
  const approvals = createApprovalService(dependencies)
  const queries = createApiQueryService(dependencies.database)
  return {
    createConversation: async (input: unknown) => {
      const parsed = parseContract(ConversationCreateInputSchema, input)
      const record = await createConversationRecord(dependencies.database, {
        conversationId: parsed.conversationId,
        userId: "mvp_user",
        now: dependencies.clock.now(),
      })
      return parseContract(ConversationSummarySchema, {
        conversationId: record.id,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      })
    },
    listConversations: async (input: unknown) => {
      parseContract(ConversationsListInputSchema, input)
      const records = await listConversationRecords(dependencies.database, { userId: "mvp_user" })
      return parseContract(ConversationsListOutputSchema, {
        conversations: records.map((record) => ({
          conversationId: record.id,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        })),
      })
    },
    sendMessage: (input: ChatSendMessageInput) =>
      admission.admit({
        commandId: dependencies.ids.next("command"),
        createdAt: dependencies.clock.now().toISOString(),
        type: "chat.send_message",
        actorId: "mvp_user",
        payload: input,
      }),
    sendHidden: (input: unknown) => adminCommands.submit({ actorId: "mvp_admin" }, input),
    decideApproval: (input: ApprovalDecisionInput) =>
      approvals.decide({ actorId: "mvp_admin" }, input),
    conversation: queries.conversation,
    listRuns: queries.runs,
    run: queries.run,
    events: queries.events,
    listPendingApprovals: queries.pendingApprovals,
    approval: queries.approval,
    job: queries.job,
    skill: queries.skill,
    resolveCursor: async (
      runId: SnapshotCursor["runId"],
      cursor: SnapshotCursor | undefined,
      lastEventId: string | undefined,
    ): Promise<SnapshotCursor> => {
      const selected = lastEventId === undefined ? cursor : decodeTrackedCursor(lastEventId)
      const candidate = selected ?? { runId, sequence: 0 }
      if (candidate.runId !== runId) throw new CursorInvalidatedError()
      await queries.run("admin", { runId })
      if (candidate.sequence === 0) return candidate
      const inspected = await queries.events("admin", {
        runId,
        afterSequence: candidate.sequence - 1,
      })
      const event = inspected.events[0]
      if (
        event?.sequence !== candidate.sequence ||
        (candidate.eventId !== undefined && event.eventId !== candidate.eventId)
      ) {
        throw new CursorInvalidatedError()
      }
      return candidate
    },
  }
}

export type ApiServices = ReturnType<typeof createApiServices>
