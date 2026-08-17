import type { RunState } from "@agentic-chat/contracts"

import type {
  StateWorkflowInput,
  StateWorkflowSignal,
  WorkflowDirective,
  WorkflowInspectState,
  WorkflowWait,
} from "./contracts.js"

const legalTransitions = {
  queued: ["running", "failed"],
  running: ["waiting_for_tool", "waiting_for_admin", "waiting_for_user", "completed", "failed"],
  waiting_for_tool: ["running", "failed"],
  waiting_for_admin: ["running", "failed"],
  waiting_for_user: ["running", "failed"],
  completed: [],
  failed: [],
} as const satisfies Readonly<Record<RunState, readonly RunState[]>>

export class StateWorkflowTransitionError extends Error {
  readonly name = "StateWorkflowTransitionError"

  constructor(
    readonly current: RunState,
    readonly next: RunState,
  ) {
    super(`Illegal State Workflow transition: ${current} -> ${next}`)
  }
}

type TransitionTarget = {
  readonly status: RunState
  readonly wait: WorkflowWait | null
}

const waitMatchesStatus = (target: TransitionTarget): boolean => {
  switch (target.status) {
    case "waiting_for_admin":
      return target.wait?.kind === "admin"
    case "waiting_for_user":
      return target.wait?.kind === "user"
    case "waiting_for_tool":
      return target.wait?.kind === "job"
    case "queued":
    case "running":
    case "completed":
    case "failed":
      return target.wait === null
    default: {
      const exhaustiveStatus: never = target.status
      return exhaustiveStatus
    }
  }
}

export const createInitialWorkflowState = (
  input: Pick<StateWorkflowInput, "runId" | "workflowId">,
): WorkflowInspectState => ({
  workflowId: input.workflowId,
  runId: input.runId,
  status: "queued",
  historyPosition: 0,
  wait: null,
})

export const transitionWorkflowState = (
  current: WorkflowInspectState,
  target: TransitionTarget,
): WorkflowInspectState => {
  const transitionAllowed = legalTransitions[current.status].some(
    (candidate) => candidate === target.status,
  )
  if (!transitionAllowed || !waitMatchesStatus(target)) {
    throw new StateWorkflowTransitionError(current.status, target.status)
  }
  return {
    ...current,
    status: target.status,
    historyPosition: current.historyPosition + 1,
    wait: target.wait,
  }
}

export const acceptCorrelatedSignal = (
  state: WorkflowInspectState,
  signal: StateWorkflowSignal,
): StateWorkflowSignal | null => {
  if (signal.runId !== state.runId) return null
  switch (signal.kind) {
    case "admin_decision":
      return state.status === "waiting_for_admin" &&
        state.wait?.kind === "admin" &&
        signal.callId === state.wait.callId &&
        signal.approvalId === state.wait.approvalId
        ? signal
        : null
    case "user_continuation":
      return state.status === "waiting_for_user" &&
        state.wait?.kind === "user" &&
        signal.correlationId === state.wait.correlationId
        ? signal
        : null
    case "job_completion":
      return state.status === "waiting_for_tool" &&
        state.wait?.kind === "job" &&
        signal.callId === state.wait.callId &&
        signal.jobId === state.wait.jobId
        ? signal
        : null
    default: {
      const exhaustiveSignal: never = signal
      return exhaustiveSignal
    }
  }
}

export const applyWorkflowDirective = (
  state: WorkflowInspectState,
  directive: WorkflowDirective,
): WorkflowInspectState => {
  switch (directive.kind) {
    case "wait_for_admin":
      return transitionWorkflowState(state, {
        status: "waiting_for_admin",
        wait: { kind: "admin", callId: directive.callId, approvalId: directive.approvalId },
      })
    case "wait_for_user":
      return transitionWorkflowState(state, {
        status: "waiting_for_user",
        wait: { kind: "user", correlationId: directive.correlationId },
      })
    case "wait_for_job":
      return transitionWorkflowState(state, {
        status: "waiting_for_tool",
        wait: { kind: "job", callId: directive.callId, jobId: directive.jobId },
      })
    case "complete":
      return transitionWorkflowState(state, { status: "completed", wait: null })
    case "fail":
      return transitionWorkflowState(state, { status: "failed", wait: null })
    default: {
      const exhaustiveDirective: never = directive
      return exhaustiveDirective
    }
  }
}

export const signalIdempotencyKey = (workflowId: string, signal: StateWorkflowSignal): string => {
  switch (signal.kind) {
    case "admin_decision":
      return `${workflowId}/signal/admin/${signal.approvalId}`
    case "user_continuation":
      return `${workflowId}/signal/user/${signal.correlationId}`
    case "job_completion":
      return `${workflowId}/signal/job/${signal.jobId}`
    default: {
      const exhaustiveSignal: never = signal
      return exhaustiveSignal
    }
  }
}
