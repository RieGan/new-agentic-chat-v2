import {
  readApprovalSnapshot,
  readReportJob,
  readStateWorkflowRun,
  resolveStateWorkflowWait,
} from "@agentic-chat/db"
import { z } from "zod"

import { createApprovalService } from "../application/approvals.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import {
  restoreStateWorkflowState,
  stableActivityId,
  stateWorkflowContextValue,
} from "./activity-support.js"
import type { ApplySignalActivityInput, ApplySignalResult } from "./contracts.js"

const resultIdentity = (input: ApplySignalActivityInput, suffix: string) => ({
  eventId: stableActivityId("event", `${input.idempotencyKey}/${suffix}/result`),
  statusEventId: stableActivityId("event", `${input.idempotencyKey}/${suffix}/status`),
  correlationId: stableActivityId("correlation", `${input.idempotencyKey}/${suffix}`),
})

export const applyStateWorkflowSignal = async (
  dependencies: StateWorkflowActivityDependencies,
  input: ApplySignalActivityInput,
): Promise<ApplySignalResult> => {
  const run = await readStateWorkflowRun(dependencies.database, input.runId)
  if (run?.workflowIdentity !== input.workflowId || run.runtime !== "state_workflow") {
    return "ignored"
  }
  const state = restoreStateWorkflowState(run)
  const wait = state.wait
  if (wait === undefined) return run.status === "running" ? "applied" : "ignored"
  const mutation = {
    runId: input.runId,
    workflowId: input.workflowId,
    expectedVersion: state.version,
    occurredAt: dependencies.clock.now(),
  } as const
  switch (input.signal.kind) {
    case "job_completion": {
      if (
        wait.kind !== "report" ||
        wait.callId !== input.signal.callId ||
        wait.jobId !== input.signal.jobId ||
        input.signal.outcome !== "completed"
      ) {
        return "ignored"
      }
      const job = await readReportJob(dependencies.database, {
        namespace: wait.namespace,
        runId: input.runId,
        jobId: wait.jobId,
      })
      if (job?.status !== "completed" || job.reportId === undefined) return "ignored"
      const output = {
        toolName: "report.generate",
        jobId: wait.jobId,
        reportId: job.reportId,
        status: "completed",
      } as const
      state.messages = [
        ...state.messages,
        {
          role: "tool",
          content: [
            {
              kind: "tool_result",
              callId: wait.callId,
              toolName: "report.generate",
              output,
            },
          ],
        },
      ]
      state.wait = undefined
      const persisted = await resolveStateWorkflowWait(dependencies.database, {
        ...mutation,
        ...resultIdentity(input, "job"),
        callId: wait.callId,
        callStatus: "completed",
        toolName: "report.generate",
        result: z.json().parse(output),
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      return "applied"
    }
    case "admin_decision": {
      if (
        wait.kind !== "approval" ||
        wait.callId !== input.signal.callId ||
        wait.approvalId !== input.signal.approvalId
      ) {
        return "ignored"
      }
      const approval = await readApprovalSnapshot(dependencies.database, {
        runId: input.runId,
        approvalId: wait.approvalId,
        callId: wait.callId,
      })
      if (approval?.status !== input.signal.decision) return "ignored"
      const output =
        approval.status === "approved"
          ? await createApprovalService({
              ...dependencies,
              ids: {
                next: (kind) => stableActivityId("event", `${input.idempotencyKey}/${kind}`),
              },
            }).execute({
              runId: input.runId,
              approvalId: wait.approvalId,
              callId: wait.callId,
            })
          : { toolName: "notification.send_email", status: "not_sent" as const }
      state.messages = [
        ...state.messages,
        {
          role: "tool",
          content: [
            {
              kind: "tool_result",
              callId: wait.callId,
              toolName: "notification.send_email",
              output,
            },
          ],
        },
      ]
      state.wait = undefined
      const persisted = await resolveStateWorkflowWait(dependencies.database, {
        ...mutation,
        ...resultIdentity(input, "approval"),
        callId: wait.callId,
        callStatus: approval.status === "approved" ? "completed" : "rejected",
        toolName: "notification.send_email",
        result: z.json().parse(output),
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      return "applied"
    }
    case "user_continuation": {
      if (wait.kind !== "user" || wait.correlationId !== input.signal.correlationId) {
        return "ignored"
      }
      const latestUserMessage = run.userMessages.at(-1)
      const latestContextMessage = state.messages.at(-1)
      if (
        latestUserMessage !== undefined &&
        (latestContextMessage?.role !== "user" ||
          latestContextMessage.content !== latestUserMessage)
      ) {
        state.messages = [...state.messages, { role: "user", content: latestUserMessage }]
      }
      state.wait = undefined
      const persisted = await resolveStateWorkflowWait(dependencies.database, {
        ...mutation,
        ...resultIdentity(input, "user"),
        context: stateWorkflowContextValue(state),
      })
      state.version = persisted.version
      return "applied"
    }
    default: {
      const exhaustiveSignal: never = input.signal
      return exhaustiveSignal
    }
  }
}
