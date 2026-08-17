import type { RunState } from "@agentic-chat/contracts"
import { describe, expect, it } from "vitest"
import type {
  StateWorkflowSignal,
  WorkflowInspectState,
  WorkflowWait,
} from "../../src/state-workflow/contracts.js"
import {
  acceptCorrelatedSignal,
  createInitialWorkflowState,
  StateWorkflowTransitionError,
  transitionWorkflowState,
} from "../../src/state-workflow/state-machine.js"

const statuses = [
  "queued",
  "running",
  "waiting_for_tool",
  "waiting_for_admin",
  "waiting_for_user",
  "completed",
  "failed",
] as const satisfies readonly RunState[]

const legalTransitions = {
  queued: ["running", "failed"],
  running: ["waiting_for_tool", "waiting_for_admin", "waiting_for_user", "completed", "failed"],
  waiting_for_tool: ["running", "failed"],
  waiting_for_admin: ["running", "failed"],
  waiting_for_user: ["running", "failed"],
  completed: [],
  failed: [],
} as const satisfies Readonly<Record<RunState, readonly RunState[]>>

const waits = {
  waiting_for_tool: { kind: "job", callId: "call_1", jobId: "job_1" },
  waiting_for_admin: { kind: "admin", callId: "call_1", approvalId: "approval_1" },
  waiting_for_user: { kind: "user", correlationId: "correlation_1" },
} as const satisfies Readonly<Record<Extract<RunState, `waiting_${string}`>, WorkflowWait>>

const waitForStatus = (status: RunState): WorkflowWait | null => {
  switch (status) {
    case "waiting_for_tool":
    case "waiting_for_admin":
    case "waiting_for_user":
      return waits[status]
    case "queued":
    case "running":
    case "completed":
    case "failed":
      return null
    default: {
      const exhaustiveStatus: never = status
      return exhaustiveStatus
    }
  }
}

const inspectAt = (status: RunState): WorkflowInspectState => ({
  workflowId: "agent-run/run_1",
  runId: "run_1",
  status,
  historyPosition: 4,
  wait: waitForStatus(status),
})

describe("State Workflow state machine", () => {
  it("accepts every shared legal transition and increments history position", () => {
    // Given: every transition allowed by the frozen shared run-state contract.
    const cases = statuses.flatMap((current) =>
      legalTransitions[current].map((next) => ({ current, next })),
    )

    // When: each transition is applied to a workflow snapshot.
    const transitioned = cases.map(({ current, next }) =>
      transitionWorkflowState(inspectAt(current), {
        status: next,
        wait: waitForStatus(next),
      }),
    )

    // Then: every result uses the requested state and one later history position.
    expect(
      transitioned.map(({ status, historyPosition }) => ({ status, historyPosition })),
    ).toEqual(cases.map(({ next }) => ({ status: next, historyPosition: 5 })))
  })

  it("rejects every illegal shared transition", () => {
    // Given: every source and target state not present in the legal transition table.
    const cases = statuses.flatMap((current) =>
      statuses
        .filter((next) => !legalTransitions[current].some((candidate) => candidate === next))
        .map((next) => ({ current, next })),
    )

    // When/Then: each illegal transition fails with the typed workflow error.
    for (const { current, next } of cases) {
      expect(() =>
        transitionWorkflowState(inspectAt(current), {
          status: next,
          wait: waitForStatus(next),
        }),
      ).toThrow(StateWorkflowTransitionError)
    }
  })

  it("accepts only signals matching the run, wait state, and operation identities", () => {
    // Given: an Admin wait and exact approval decision signal.
    const state = inspectAt("waiting_for_admin")
    const valid = {
      kind: "admin_decision",
      runId: "run_1",
      callId: "call_1",
      approvalId: "approval_1",
      decision: "approved",
    } as const satisfies StateWorkflowSignal
    const invalid = [
      { ...valid, runId: "run_other" },
      { ...valid, callId: "call_other" },
      { ...valid, approvalId: "approval_other" },
      { kind: "user_continuation", runId: "run_1", correlationId: "correlation_1" },
      {
        kind: "job_completion",
        runId: "run_1",
        callId: "call_1",
        jobId: "job_1",
        outcome: "completed",
      },
    ] as const satisfies readonly StateWorkflowSignal[]

    // When: matching and mismatched signals are evaluated.
    const accepted = acceptCorrelatedSignal(state, valid)
    const rejected = invalid.map((signal) => acceptCorrelatedSignal(state, signal))

    // Then: only the exact signal is accepted and inspection state is untouched.
    expect(accepted).toEqual(valid)
    expect(rejected).toEqual(invalid.map(() => null))
    expect(state).toEqual(inspectAt("waiting_for_admin"))
  })

  it("rejects all signals before a wait and after terminal state", () => {
    // Given: queued and terminal workflow snapshots plus every signal kind.
    const signals = [
      {
        kind: "admin_decision",
        runId: "run_1",
        callId: "call_1",
        approvalId: "approval_1",
        decision: "rejected",
      },
      { kind: "user_continuation", runId: "run_1", correlationId: "correlation_1" },
      {
        kind: "job_completion",
        runId: "run_1",
        callId: "call_1",
        jobId: "job_1",
        outcome: "failed",
      },
    ] as const satisfies readonly StateWorkflowSignal[]

    // When: signals target workflows before initialization or after completion/failure.
    const results = [
      createInitialWorkflowState({ workflowId: "agent-run/run_1", runId: "run_1" }),
      inspectAt("completed"),
      inspectAt("failed"),
    ].flatMap((state) => signals.map((signal) => acceptCorrelatedSignal(state, signal)))

    // Then: no signal is admitted.
    expect(results).toEqual(results.map(() => null))
  })

  it("rejects wrong User and job correlation identities without changing state", () => {
    // Given: exact User and job waits with signals varying every immutable identity.
    const userState = inspectAt("waiting_for_user")
    const jobState = inspectAt("waiting_for_tool")
    const signals = [
      {
        state: userState,
        signal: {
          kind: "user_continuation",
          runId: "run_wrong",
          correlationId: "correlation_1",
        },
      },
      {
        state: userState,
        signal: {
          kind: "user_continuation",
          runId: "run_1",
          correlationId: "correlation_wrong",
        },
      },
      {
        state: jobState,
        signal: {
          kind: "job_completion",
          runId: "run_wrong",
          callId: "call_1",
          jobId: "job_1",
          outcome: "completed",
        },
      },
      {
        state: jobState,
        signal: {
          kind: "job_completion",
          runId: "run_1",
          callId: "call_wrong",
          jobId: "job_1",
          outcome: "completed",
        },
      },
      {
        state: jobState,
        signal: {
          kind: "job_completion",
          runId: "run_1",
          callId: "call_1",
          jobId: "job_wrong",
          outcome: "completed",
        },
      },
    ] as const satisfies readonly {
      readonly state: WorkflowInspectState
      readonly signal: StateWorkflowSignal
    }[]

    // When: every mismatched signal is evaluated.
    const results = signals.map(({ state, signal }) => acceptCorrelatedSignal(state, signal))

    // Then: all are rejected and both snapshots retain their original values.
    expect(results).toEqual(results.map(() => null))
    expect(userState).toEqual(inspectAt("waiting_for_user"))
    expect(jobState).toEqual(inspectAt("waiting_for_tool"))
  })
})
