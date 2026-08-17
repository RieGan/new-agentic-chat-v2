import { createHash } from "node:crypto"

import {
  ApprovalIdSchema,
  CallIdSchema,
  JobIdSchema,
  NotificationSendArgumentsSchema,
  parseContract,
  ReportGenerateArgumentsSchema,
  ReportIdSchema,
} from "@agentic-chat/contracts"
import {
  markReportDispatched,
  persistSimpleLoopApprovalWait,
  persistSimpleLoopReportWait,
} from "@agentic-chat/db"
import { z } from "zod"

import type { ReportJobQueue } from "../application/report-jobs.js"
import { ProviderMessageSchema } from "../provider/contracts.js"
import type { SimpleLoopDependencies } from "./runtime.js"
import { type ActiveSimpleLoopRun, mutationIdentity } from "./runtime-session.js"
import { contextValue } from "./runtime-support.js"
import { hashToolArguments, type MutableLoopState } from "./tools.js"

export type DurableWaitConfiguration = {
  readonly namespace: string
  readonly reportQueue: ReportJobQueue
  readonly approvalTtlMs?: number
}

type DeferredCall = {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: unknown
}

export type SimpleLoopWaitResult =
  | { readonly status: "waiting_for_tool"; readonly callId: string; readonly jobId: string }
  | { readonly status: "waiting_for_admin"; readonly callId: string; readonly approvalId: string }

const reportIdentity = (namespace: string, runId: string, callId: string) => {
  const digest = createHash("sha256")
    .update(JSON.stringify([namespace, runId, callId]))
    .digest("hex")
    .slice(0, 24)
  return {
    namespace,
    ledgerKey: `report-job-${digest}`,
    runId,
    callId,
    jobId: parseContract(JobIdSchema, "job_001"),
    reportId: parseContract(ReportIdSchema, "report_001"),
    bullmqJobId: `report-${digest}`,
  } as const
}

const appendAssistantCall = (state: MutableLoopState, call: DeferredCall): void => {
  state.messages = [
    ...state.messages,
    parseContract(ProviderMessageSchema, {
      role: "assistant",
      content: [
        {
          kind: "tool_call",
          callId: call.toolCallId,
          toolName: call.toolName,
          arguments: call.input,
        },
      ],
    }),
  ]
}

export const persistDeferredCall = async (
  dependencies: SimpleLoopDependencies,
  active: ActiveSimpleLoopRun,
  state: MutableLoopState,
  call: DeferredCall,
): Promise<SimpleLoopWaitResult | undefined> => {
  const configuration = dependencies.durableWaits
  if (configuration === undefined) return undefined
  switch (call.toolName) {
    case "report.generate": {
      const callId = parseContract(CallIdSchema, call.toolCallId)
      const arguments_ = parseContract(ReportGenerateArgumentsSchema, call.input)
      const identity = reportIdentity(configuration.namespace, active.runId, callId)
      appendAssistantCall(state, call)
      state.wait = {
        kind: "report",
        namespace: identity.namespace,
        ledgerKey: identity.ledgerKey,
        callId,
        jobId: identity.jobId,
        reportId: identity.reportId,
      }
      const eventPrefix = `report-${identity.bullmqJobId.slice("report-".length)}`
      const persisted = await persistSimpleLoopReportWait(dependencies.database, {
        ...mutationIdentity(active, state),
        ...identity,
        arguments: z.json().parse(arguments_),
        argumentsHash: hashToolArguments(arguments_),
        eventId: active.ids.next("event"),
        statusEventId: active.ids.next("event"),
        correlationId: active.ids.next("correlation"),
        acceptedEventId: `${eventPrefix}-accepted`,
        runAcceptedEventId: `${eventPrefix}-run-accepted`,
        dispatchId: `${eventPrefix}-dispatch`,
        context: contextValue(state),
      })
      state.version = persisted.version
      await configuration.reportQueue.enqueue(identity)
      await markReportDispatched(dependencies.database, {
        intentId: `${eventPrefix}-dispatch`,
        dispatchedAt: active.clock.now(),
      })
      return { status: "waiting_for_tool", callId, jobId: identity.jobId }
    }
    case "notification.send_email": {
      const callId = parseContract(CallIdSchema, call.toolCallId)
      const arguments_ = parseContract(NotificationSendArgumentsSchema, call.input)
      const approvalId = parseContract(ApprovalIdSchema, active.ids.next("approval"))
      appendAssistantCall(state, call)
      state.wait = { kind: "approval", callId, approvalId }
      const persisted = await persistSimpleLoopApprovalWait(dependencies.database, {
        ...mutationIdentity(active, state),
        callId,
        approvalId,
        arguments: z.json().parse(arguments_),
        expiresAt: new Date(
          active.clock.now().getTime() + (configuration.approvalTtlMs ?? 300_000),
        ),
        eventId: active.ids.next("event"),
        approvalEventId: active.ids.next("event"),
        statusEventId: active.ids.next("event"),
        correlationId: active.ids.next("correlation"),
        context: contextValue(state),
      })
      state.version = persisted.version
      return { status: "waiting_for_admin", callId, approvalId }
    }
    default:
      return undefined
  }
}
