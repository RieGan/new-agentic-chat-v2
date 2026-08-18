import type { ApprovalEnvelope, CanonicalEvent, RunSnapshot } from "@agentic-chat/contracts"

type UiOutcomeStore = {
  readonly runs: ReadonlyMap<string, RunSnapshot>
  readonly approvals: Map<string, ApprovalEnvelope>
  readonly append: (runId: string, candidate: unknown) => CanonicalEvent
  readonly complete: (runId: string, text: string) => void
  readonly seedApproval: (id: string, runId: string) => ApprovalEnvelope
  readonly setStatus: (runId: string, status: RunSnapshot["status"]) => void
}

type ScheduleOutcomeInput = {
  readonly store: UiOutcomeStore
  readonly runId: string
  readonly message: string
  readonly invocation: string
}

export const scheduleFixtureOutcome = ({
  store,
  runId,
  message,
  invocation,
}: ScheduleOutcomeInput): void => {
  if (message.includes("report")) {
    setTimeout(() => {
      store.append(runId, {
        type: "tool.call.started",
        visibility: "user",
        payload: { callId: `call_${runId}`, toolName: "report.generate" },
      })
      store.append(runId, {
        type: "job.accepted",
        visibility: "user",
        payload: { jobId: `job_${runId}`, callId: `call_${runId}`, status: "queued" },
      })
      store.append(runId, {
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
      store.append(runId, {
        type: "job.completed",
        visibility: "user",
        payload: {
          jobId: `job_${runId}`,
          callId: `call_${runId}`,
          status: "completed",
          reportId: `report_${runId}`,
        },
      })
      store.complete(
        runId,
        `Report completed on ${store.runs.get(runId)?.runtime.replaceAll("_", " ")}.`,
      )
    }, 80)
    return
  }
  if (message.includes("approval")) {
    setTimeout(() => {
      const approval = store.seedApproval(`approval_${invocation}`, runId)
      store.approvals.set(approval.approvalId, approval)
      store.append(runId, {
        type: "tool.call.approval_required",
        visibility: "user",
        payload: {
          callId: approval.callId,
          toolName: approval.toolName,
          approvalId: approval.approvalId,
        },
      })
      store.append(runId, {
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
      store.append(runId, {
        type: "run.status_changed",
        visibility: "user",
        payload: { previous: "running", current: "waiting_for_admin" },
      })
      store.setStatus(runId, "waiting_for_admin")
    }, 30)
    return
  }
  setTimeout(
    () =>
      store.complete(
        runId,
        `Direct answer from ${store.runs.get(runId)?.runtime.replaceAll("_", " ")}: ${message}.`,
      ),
    45,
  )
}
