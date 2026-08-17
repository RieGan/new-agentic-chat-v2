import { z } from "zod"

import {
  IllegalTransitionError,
  ImmutableRuntimeAssignmentError,
  LoopStepLimitExceededError,
  StaleLeaseError,
  StaleVersionError,
} from "./errors.js"
import type { Runtime } from "./primitives.js"

export const RunStateSchema = z.enum([
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_admin",
  "waiting_for_user",
  "completed",
  "failed",
])
export type RunState = z.infer<typeof RunStateSchema>

export const ToolCallStateSchema = z.enum([
  "prepared",
  "running",
  "approval_required",
  "waiting_job",
  "completed",
  "failed",
  "rejected",
])
export type ToolCallState = z.infer<typeof ToolCallStateSchema>

export const ApprovalStateSchema = z.enum(["pending", "approved", "rejected", "expired"])
export type ApprovalState = z.infer<typeof ApprovalStateSchema>

export const JobStateSchema = z.enum(["queued", "running", "completed", "failed"])
export type JobState = z.infer<typeof JobStateSchema>

export const AdminCommandStateSchema = z.enum(["accepted", "applied", "rejected", "expired"])
export type AdminCommandState = z.infer<typeof AdminCommandStateSchema>

const runTransitions = {
  queued: ["running", "failed"],
  running: ["waiting_for_tool", "waiting_for_admin", "waiting_for_user", "completed", "failed"],
  waiting_for_tool: ["running", "failed"],
  waiting_for_admin: ["running", "failed"],
  waiting_for_user: ["running", "failed"],
  completed: [],
  failed: [],
} as const satisfies Readonly<Record<RunState, readonly RunState[]>>

const toolCallTransitions = {
  prepared: ["running", "approval_required", "failed", "rejected"],
  running: ["waiting_job", "completed", "failed"],
  approval_required: ["running", "rejected", "failed"],
  waiting_job: ["completed", "failed"],
  completed: [],
  failed: [],
  rejected: [],
} as const satisfies Readonly<Record<ToolCallState, readonly ToolCallState[]>>

const approvalTransitions = {
  pending: ["approved", "rejected", "expired"],
  approved: [],
  rejected: [],
  expired: [],
} as const satisfies Readonly<Record<ApprovalState, readonly ApprovalState[]>>

const jobTransitions = {
  queued: ["running", "completed", "failed"],
  running: ["completed", "failed"],
  completed: [],
  failed: [],
} as const satisfies Readonly<Record<JobState, readonly JobState[]>>

const adminCommandTransitions = {
  accepted: ["applied", "rejected", "expired"],
  applied: [],
  rejected: [],
  expired: [],
} as const satisfies Readonly<Record<AdminCommandState, readonly AdminCommandState[]>>

type TransitionCheck<State extends string> = {
  readonly entity: string
  readonly current: State
  readonly next: State
  readonly allowed: Readonly<Record<State, readonly State[]>>
}

const assertTransition = <State extends string>(check: TransitionCheck<State>): State => {
  if (!check.allowed[check.current].includes(check.next)) {
    throw new IllegalTransitionError(check)
  }
  return check.next
}

export const isRunTransitionAllowed = (current: RunState, next: RunState): boolean =>
  runTransitions[current].some((candidate) => candidate === next)

export const assertRunTransition = (current: RunState, next: RunState): RunState =>
  assertTransition({ entity: "run", current, next, allowed: runTransitions })

export const assertToolCallTransition = (
  current: ToolCallState,
  next: ToolCallState,
): ToolCallState =>
  assertTransition({ entity: "tool_call", current, next, allowed: toolCallTransitions })

export const assertApprovalTransition = (
  current: ApprovalState,
  next: ApprovalState,
): ApprovalState =>
  assertTransition({ entity: "approval", current, next, allowed: approvalTransitions })

export const assertJobTransition = (current: JobState, next: JobState): JobState =>
  assertTransition({ entity: "job", current, next, allowed: jobTransitions })

export const assertAdminCommandTransition = (
  current: AdminCommandState,
  next: AdminCommandState,
): AdminCommandState =>
  assertTransition({ entity: "admin_command", current, next, allowed: adminCommandTransitions })

export const assertRuntimeAssignment = (assigned: Runtime, requested: Runtime): Runtime => {
  if (assigned !== requested) {
    throw new ImmutableRuntimeAssignmentError(assigned, requested)
  }
  return assigned
}

export const assertVersion = (expected: number, actual: number): number => {
  if (expected !== actual) {
    throw new StaleVersionError(expected, actual)
  }
  return actual
}

export const assertLease = (expected: number, actual: number): number => {
  if (expected !== actual) {
    throw new StaleLeaseError(expected, actual)
  }
  return actual
}

export const LOOP_STEP_BUDGET = 8 as const

export const LoopBudgetSchema = z
  .object({
    consumed: z.number().int().min(0).max(LOOP_STEP_BUDGET),
    limit: z.literal(LOOP_STEP_BUDGET),
  })
  .strict()
export type LoopBudget = z.infer<typeof LoopBudgetSchema>

export const consumeLoopStep = (budget: LoopBudget): LoopBudget => {
  if (budget.consumed >= budget.limit) {
    throw new LoopStepLimitExceededError(budget.limit)
  }
  return LoopBudgetSchema.parse({ consumed: budget.consumed + 1, limit: budget.limit })
}
