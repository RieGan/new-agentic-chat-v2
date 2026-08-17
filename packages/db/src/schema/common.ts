import type {
  AdminCommandState,
  ApprovalState,
  JobState,
  RunState,
  Runtime,
  ToolCallState,
  Visibility,
} from "@agentic-chat/contracts"
import { pgEnum } from "drizzle-orm/pg-core"

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

const runtimeValues = ["simple_loop", "state_workflow"] as const satisfies readonly Runtime[]
const runStatusValues = [
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_admin",
  "waiting_for_user",
  "completed",
  "failed",
] as const satisfies readonly RunState[]
const toolCallStatusValues = [
  "prepared",
  "running",
  "approval_required",
  "waiting_job",
  "completed",
  "failed",
  "rejected",
] as const satisfies readonly ToolCallState[]
const approvalStatusValues = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const satisfies readonly ApprovalState[]
const jobStatusValues = [
  "queued",
  "running",
  "completed",
  "failed",
] as const satisfies readonly JobState[]
const adminCommandStatusValues = [
  "accepted",
  "applied",
  "rejected",
  "expired",
] as const satisfies readonly AdminCommandState[]
const visibilityValues = [
  "user",
  "admin",
  "model_only",
  "internal",
] as const satisfies readonly Visibility[]

export const runtimeEnum = pgEnum("runtime", runtimeValues)
export const runStatusEnum = pgEnum("run_status", runStatusValues)
export const toolCallStatusEnum = pgEnum("tool_call_status", toolCallStatusValues)
export const approvalStatusEnum = pgEnum("approval_status", approvalStatusValues)
export const jobStatusEnum = pgEnum("job_status", jobStatusValues)
export const adminCommandStatusEnum = pgEnum("admin_command_status", adminCommandStatusValues)
export const visibilityEnum = pgEnum("visibility", visibilityValues)

export const messageActorEnum = pgEnum("message_actor", ["user", "ai"])
export const roleNameEnum = pgEnum("role_name", ["user", "admin"])
export const toolModeEnum = pgEnum("tool_mode", ["sync", "async"])
export const toolRiskEnum = pgEnum("tool_risk", ["read", "low", "high"])
export const approvalDecisionEnum = pgEnum("approval_decision", ["approved", "rejected"])
export const dispatchStatusEnum = pgEnum("dispatch_status", ["pending", "dispatched", "failed"])
