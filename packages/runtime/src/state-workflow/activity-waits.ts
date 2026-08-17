import { createHash } from "node:crypto"

import {
  ApprovalIdSchema,
  type CallId,
  CallIdSchema,
  JobIdSchema,
  NotificationSendArgumentsSchema,
  parseContract,
  ReportGenerateArgumentsSchema,
  ReportIdSchema,
} from "@agentic-chat/contracts"
import {
  markReportDispatched,
  persistStateWorkflowApprovalWait,
  persistStateWorkflowReportWait,
} from "@agentic-chat/db"
import { z } from "zod"

import { ProviderMessageSchema } from "../provider/contracts.js"
import { hashToolArguments } from "../simple-loop/tools.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import {
  type MutableStateWorkflowRun,
  stableActivityId,
  stateWorkflowContextValue,
} from "./activity-support.js"
import type { AdvanceRunActivityInput, WorkflowDirective } from "./contracts.js"

type DeferredCall = {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: unknown
}

const reportIdentity = (namespace: string, runId: string, callId: CallId) => {
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

const appendAssistantCall = (state: MutableStateWorkflowRun, call: DeferredCall): void => {
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

export const canonicalWaitDirective = (
  state: MutableStateWorkflowRun,
): WorkflowDirective | undefined => {
  const wait = state.wait
  if (wait === undefined) return undefined
  switch (wait.kind) {
    case "report":
      return { kind: "wait_for_job", callId: wait.callId, jobId: wait.jobId }
    case "approval":
      return { kind: "wait_for_admin", callId: wait.callId, approvalId: wait.approvalId }
    case "user":
      return { kind: "wait_for_user", correlationId: wait.correlationId }
    default: {
      const exhaustiveWait: never = wait
      return exhaustiveWait
    }
  }
}

export const persistStateWorkflowDeferredCall = async (
  dependencies: StateWorkflowActivityDependencies,
  input: AdvanceRunActivityInput,
  state: MutableStateWorkflowRun,
  call: DeferredCall,
): Promise<WorkflowDirective | undefined> => {
  const configuration = dependencies.durableWaits
  if (configuration === undefined) return undefined
  const mutation = {
    runId: input.runId,
    workflowId: input.workflowId,
    expectedVersion: state.version,
    occurredAt: dependencies.clock.now(),
  } as const
  switch (call.toolName) {
    case "report.generate": {
      const callId = parseContract(CallIdSchema, call.toolCallId)
      const arguments_ = parseContract(ReportGenerateArgumentsSchema, call.input)
      const identity = reportIdentity(configuration.namespace, input.runId, callId)
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
      const persisted = await persistStateWorkflowReportWait(dependencies.database, {
        ...mutation,
        ...identity,
        arguments: z.json().parse(arguments_),
        argumentsHash: hashToolArguments(arguments_),
        eventId: stableActivityId("event", `${input.idempotencyKey}/report/wait`),
        statusEventId: stableActivityId("event", `${input.idempotencyKey}/report/status`),
        correlationId: callId,
        acceptedEventId: `${eventPrefix}-accepted`,
        runAcceptedEventId: `${eventPrefix}-run-accepted`,
        dispatchId: `${eventPrefix}-dispatch`,
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      await configuration.reportQueue.enqueue(identity)
      await markReportDispatched(dependencies.database, {
        intentId: `${eventPrefix}-dispatch`,
        dispatchedAt: dependencies.clock.now(),
      })
      return { kind: "wait_for_job", callId, jobId: identity.jobId }
    }
    case "notification.send_email": {
      const callId = parseContract(CallIdSchema, call.toolCallId)
      const arguments_ = parseContract(NotificationSendArgumentsSchema, call.input)
      const approvalId = parseContract(
        ApprovalIdSchema,
        stableActivityId("call", `${input.idempotencyKey}/approval/${callId}`).replace(
          "call_",
          "approval_",
        ),
      )
      appendAssistantCall(state, call)
      state.wait = { kind: "approval", callId, approvalId }
      const persisted = await persistStateWorkflowApprovalWait(dependencies.database, {
        ...mutation,
        callId,
        approvalId,
        arguments: z.json().parse(arguments_),
        expiresAt: new Date(
          dependencies.clock.now().getTime() + (configuration.approvalTtlMs ?? 300_000),
        ),
        eventId: stableActivityId("event", `${input.idempotencyKey}/approval/wait`),
        approvalEventId: stableActivityId("event", `${input.idempotencyKey}/approval/requested`),
        statusEventId: stableActivityId("event", `${input.idempotencyKey}/approval/status`),
        correlationId: callId,
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      return { kind: "wait_for_admin", callId, approvalId }
    }
    default:
      return undefined
  }
}
