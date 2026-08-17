import { describe, expect, it } from "vitest"

import {
  AdminCommandStateSchema,
  ApprovalStateSchema,
  assertAdminCommandTransition,
  assertApprovalTransition,
  assertJobTransition,
  assertLease,
  assertRunTransition,
  assertRuntimeAssignment,
  assertToolCallTransition,
  assertVersion,
  consumeLoopStep,
  IllegalTransitionError,
  ImmutableRuntimeAssignmentError,
  JobStateSchema,
  LOOP_STEP_BUDGET,
  LoopStepLimitExceededError,
  RunStateSchema,
  StaleLeaseError,
  StaleVersionError,
  ToolCallStateSchema,
} from "../src/index.js"

describe("shared state transitions", () => {
  it.each([
    ["queued", "running"],
    ["running", "waiting_for_tool"],
    ["running", "waiting_for_admin"],
    ["running", "waiting_for_user"],
    ["waiting_for_tool", "running"],
    ["waiting_for_admin", "running"],
    ["waiting_for_user", "running"],
    ["running", "completed"],
    ["queued", "failed"],
    ["running", "failed"],
  ] as const)("accepts legal run transition %s -> %s", (current, next) => {
    expect(assertRunTransition(current, next)).toBe(next)
  })

  it.each([
    ["completed", "running"],
    ["failed", "running"],
    ["queued", "completed"],
    ["waiting_for_user", "waiting_for_tool"],
  ] as const)("rejects illegal run transition %s -> %s", (current, next) => {
    expect(() => assertRunTransition(current, next)).toThrow(IllegalTransitionError)
  })

  it.each([
    ["prepared", "running"],
    ["prepared", "approval_required"],
    ["running", "waiting_job"],
    ["running", "completed"],
    ["waiting_job", "completed"],
  ] as const)("accepts legal tool transition %s -> %s", (current, next) => {
    expect(assertToolCallTransition(current, next)).toBe(next)
  })

  it.each([
    ["pending", "approved"],
    ["pending", "rejected"],
    ["pending", "expired"],
  ] as const)("accepts legal approval transition %s -> %s", (current, next) => {
    expect(assertApprovalTransition(current, next)).toBe(next)
  })

  it.each([
    ["queued", "running"],
    ["running", "completed"],
  ] as const)("accepts legal job transition %s -> %s", (current, next) => {
    expect(assertJobTransition(current, next)).toBe(next)
  })

  it.each([
    ["accepted", "applied"],
    ["accepted", "rejected"],
  ] as const)("accepts legal Admin command transition %s -> %s", (current, next) => {
    expect(assertAdminCommandTransition(current, next)).toBe(next)
  })

  it("rejects terminal tool transitions", () => {
    expect(() => assertToolCallTransition("completed", "running")).toThrow(IllegalTransitionError)
  })

  it("rejects terminal approval transitions", () => {
    expect(() => assertApprovalTransition("approved", "rejected")).toThrow(IllegalTransitionError)
  })

  it("rejects terminal job transitions", () => {
    expect(() => assertJobTransition("completed", "running")).toThrow(IllegalTransitionError)
  })

  it("rejects terminal Admin command transitions", () => {
    expect(() => assertAdminCommandTransition("applied", "expired")).toThrow(IllegalTransitionError)
  })

  it("exports every frozen state through its runtime schema", () => {
    expect(RunStateSchema.options).toHaveLength(7)
    expect(ToolCallStateSchema.options).toHaveLength(7)
    expect(ApprovalStateSchema.options).toHaveLength(4)
    expect(JobStateSchema.options).toHaveLength(4)
    expect(AdminCommandStateSchema.options).toHaveLength(4)
  })
})

describe("runtime fencing and loop budget", () => {
  it("rejects changing the assigned runtime", () => {
    expect(() => assertRuntimeAssignment("simple_loop", "state_workflow")).toThrow(
      ImmutableRuntimeAssignmentError,
    )
  })

  it("rejects stale aggregate and lease versions", () => {
    expect(() => assertVersion(4, 5)).toThrow(StaleVersionError)
    expect(() => assertLease(7, 8)).toThrow(StaleLeaseError)
  })

  it("exports and enforces the exact eight-step budget", () => {
    expect(LOOP_STEP_BUDGET).toBe(8)
    expect(consumeLoopStep({ consumed: 7, limit: LOOP_STEP_BUDGET })).toEqual({
      consumed: 8,
      limit: 8,
    })
    expect(() => consumeLoopStep({ consumed: 8, limit: LOOP_STEP_BUDGET })).toThrow(
      LoopStepLimitExceededError,
    )
  })
})
