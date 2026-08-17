import { parseContract } from "@agentic-chat/contracts"
import { readApprovalSnapshot, readReportJob, resolveSimpleLoopWait } from "@agentic-chat/db"
import { z } from "zod"

import { createApprovalService } from "../application/approvals.js"
import { ProviderMessageSchema } from "../provider/contracts.js"
import type { SimpleLoopDependencies } from "./runtime.js"
import { type ActiveSimpleLoopRun, mutationIdentity } from "./runtime-session.js"
import { contextValue } from "./runtime-support.js"
import type { MutableLoopState } from "./tools.js"

export const waitIsReady = async (
  dependencies: SimpleLoopDependencies,
  runId: string,
  wait: NonNullable<MutableLoopState["wait"]>,
): Promise<boolean> => {
  switch (wait.kind) {
    case "report": {
      const job = await readReportJob(dependencies.database, { ...wait, runId })
      return job?.status === "completed"
    }
    case "approval": {
      const approval = await readApprovalSnapshot(dependencies.database, {
        runId,
        approvalId: wait.approvalId,
        callId: wait.callId,
      })
      return approval?.status === "approved" || approval?.status === "rejected"
    }
    case "user":
      return true
    default: {
      const exhaustiveWait: never = wait
      return exhaustiveWait
    }
  }
}

export const resolveDeferredCall = async (
  dependencies: SimpleLoopDependencies,
  active: ActiveSimpleLoopRun,
  state: MutableLoopState,
): Promise<void> => {
  const wait = state.wait
  if (wait === undefined || wait.kind === "user") {
    state.wait = undefined
    return
  }
  const result = await (async () => {
    switch (wait.kind) {
      case "report": {
        const job = await readReportJob(dependencies.database, { ...wait, runId: active.runId })
        if (job?.status !== "completed" || job.reportId === undefined) {
          throw new TypeError("Report wait resumed before canonical completion")
        }
        return {
          callStatus: "completed" as const,
          output: {
            toolName: "report.generate",
            jobId: wait.jobId,
            reportId: job.reportId,
            status: "completed",
          },
        }
      }
      case "approval": {
        const approval = await readApprovalSnapshot(dependencies.database, {
          runId: active.runId,
          approvalId: wait.approvalId,
          callId: wait.callId,
        })
        if (approval?.status === "approved") {
          const sent = await createApprovalService(dependencies).execute({
            runId: active.runId,
            approvalId: wait.approvalId,
            callId: wait.callId,
          })
          return { callStatus: "completed" as const, output: sent }
        }
        if (approval?.status === "rejected") {
          return {
            callStatus: "rejected" as const,
            output: { toolName: "notification.send_email", status: "not_sent" },
          }
        }
        throw new TypeError("Approval wait resumed before a canonical decision")
      }
      default: {
        const exhaustiveWait: never = wait
        return exhaustiveWait
      }
    }
  })()
  state.messages = [
    ...state.messages,
    parseContract(ProviderMessageSchema, {
      role: "tool",
      content: [
        {
          kind: "tool_result",
          callId: wait.callId,
          toolName: wait.kind === "report" ? "report.generate" : "notification.send_email",
          output: result.output,
        },
      ],
    }),
  ]
  state.wait = undefined
  const persisted = await resolveSimpleLoopWait(dependencies.database, {
    ...mutationIdentity(active, state),
    callId: wait.callId,
    callStatus: result.callStatus,
    toolName: wait.kind === "report" ? "report.generate" : "notification.send_email",
    result: z.json().parse(result.output),
    eventId: active.ids.next("event"),
    statusEventId: active.ids.next("event"),
    correlationId: active.ids.next("correlation"),
    context: contextValue(state),
  })
  state.version = persisted.version
}
