import type { RunState } from "@agentic-chat/contracts"

export type AdminDecisionSignal = {
  readonly kind: "admin_decision"
  readonly runId: string
  readonly callId: string
  readonly approvalId: string
  readonly decision: "approved" | "rejected"
}

export type UserContinuationSignal = {
  readonly kind: "user_continuation"
  readonly runId: string
  readonly correlationId: string
}

export type JobCompletionSignal = {
  readonly kind: "job_completion"
  readonly runId: string
  readonly callId: string
  readonly jobId: string
  readonly outcome: "completed" | "failed"
}

export type StateWorkflowSignal = AdminDecisionSignal | UserContinuationSignal | JobCompletionSignal

export type WorkflowWait =
  | {
      readonly kind: "admin"
      readonly callId: string
      readonly approvalId: string
    }
  | { readonly kind: "user"; readonly correlationId: string }
  | { readonly kind: "job"; readonly callId: string; readonly jobId: string }

export type WorkflowInspectState = {
  readonly workflowId: string
  readonly runId: string
  readonly status: RunState
  readonly historyPosition: number
  readonly wait: WorkflowWait | null
}

export type StateWorkflowInput = {
  readonly workflowId: string
  readonly runId: string
  readonly intentId: string
}

export type WorkflowDirective =
  | { readonly kind: "wait_for_admin"; readonly callId: string; readonly approvalId: string }
  | { readonly kind: "wait_for_user"; readonly correlationId: string }
  | { readonly kind: "wait_for_job"; readonly callId: string; readonly jobId: string }
  | { readonly kind: "complete" }
  | { readonly kind: "fail" }

type ActivityInput = {
  readonly runId: string
  readonly workflowId: string
  readonly historyPosition: number
  readonly idempotencyKey: string
}

export type ReconcileStartActivityInput = ActivityInput & {
  readonly intentId: string
}

export type AdvanceRunActivityInput = ActivityInput

export type ApplySignalActivityInput = ActivityInput & {
  readonly signal: StateWorkflowSignal
}

export type ApplySignalResult = "applied" | "ignored"

export interface StateWorkflowActivities {
  reconcileStart(input: ReconcileStartActivityInput): Promise<void>
  advanceRun(input: AdvanceRunActivityInput): Promise<WorkflowDirective>
  applySignal(input: ApplySignalActivityInput): Promise<ApplySignalResult>
}

export interface StateWorkflowActivityAdapter {
  reconcileStartOnce(input: ReconcileStartActivityInput): Promise<void>
  advanceRunOnce(input: AdvanceRunActivityInput): Promise<WorkflowDirective>
  applySignalOnce(input: ApplySignalActivityInput): Promise<ApplySignalResult>
}

export type PendingWorkflowStart = {
  readonly intentId: string
  readonly runId: string
  readonly runtime: "state_workflow"
  readonly workflowIdentity: string
  readonly payload: unknown
}
