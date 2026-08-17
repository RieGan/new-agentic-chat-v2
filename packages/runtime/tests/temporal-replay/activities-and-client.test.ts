import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client"
import { describe, expect, it } from "vitest"

import { createStateWorkflowActivities } from "../../src/state-workflow/activities.js"
import {
  createTemporalWorkflowStarter,
  reconcileWorkflowStarts,
  STATE_WORKFLOW_START_POLICIES,
  stateWorkflowId,
} from "../../src/state-workflow/client.js"
import type {
  AdvanceRunActivityInput,
  ApplySignalActivityInput,
  ReconcileStartActivityInput,
  WorkflowDirective,
} from "../../src/state-workflow/contracts.js"

describe("State Workflow Activities", () => {
  it("reuses stable idempotency keys when an Activity delivery is retried", async () => {
    // Given: a canonical adapter that executes each idempotency key once.
    const effects = new Set<string>()
    let canonicalWrites = 0
    const commit = (input: ReconcileStartActivityInput | ApplySignalActivityInput): void => {
      if (!effects.has(input.idempotencyKey)) {
        effects.add(input.idempotencyKey)
        canonicalWrites += 1
      }
    }
    const activities = createStateWorkflowActivities({
      reconcileStartOnce: async (input) => commit(input),
      advanceRunOnce: async (_input: AdvanceRunActivityInput) =>
        ({ kind: "complete" }) satisfies WorkflowDirective,
      applySignalOnce: async (input) => {
        commit(input)
        return "applied"
      },
    })
    const input = {
      runId: "run_1",
      workflowId: "agent-run/run_1",
      intentId: "intent_1",
      historyPosition: 1,
      idempotencyKey: "agent-run/run_1/start/intent_1",
    } as const satisfies ReconcileStartActivityInput

    // When: Temporal delivers the same logical Activity twice.
    await activities.reconcileStart(input)
    await activities.reconcileStart(input)

    // Then: the canonical adapter observes one logical write.
    expect(canonicalWrites).toBe(1)
    expect(effects).toEqual(new Set([input.idempotencyKey]))
  })
})

describe("State Workflow start reconciliation", () => {
  it("uses deterministic identity with explicit reject/fail policies", async () => {
    // Given: a structural Temporal client that captures start options.
    const starts: unknown[] = []
    const starter = createTemporalWorkflowStarter({
      taskQueue: "state-workflow",
      workflowClient: {
        start: async (_workflow, options) => {
          starts.push(options)
          return { workflowId: options.workflowId }
        },
      },
    })

    // When: one admitted workflow intent is started.
    const result = await starter.start({
      intentId: "intent_1",
      runId: "run_1",
      runtime: "state_workflow",
      workflowIdentity: "agent-run/run_1",
      payload: { runId: "run_1" },
    })

    // Then: immutable identity and both collision policies are explicit.
    expect(result).toBe("started")
    expect(stateWorkflowId("run_1")).toBe("agent-run/run_1")
    expect(starts).toEqual([
      expect.objectContaining({
        workflowId: "agent-run/run_1",
        taskQueue: "state-workflow",
        workflowIdReusePolicy: STATE_WORKFLOW_START_POLICIES.workflowIdReusePolicy,
        workflowIdConflictPolicy: STATE_WORKFLOW_START_POLICIES.workflowIdConflictPolicy,
      }),
    ])
  })

  it("treats an existing deterministic execution as reconciled without a duplicate start", async () => {
    // Given: one pending intent and a Temporal start collision for its immutable workflow ID.
    let attempts = 0
    const pending = {
      intentId: "intent_1",
      runId: "run_1",
      runtime: "state_workflow",
      workflowIdentity: "agent-run/run_1",
      payload: { runId: "run_1" },
    } as const
    const starter = {
      start: async () => {
        attempts += 1
        if (attempts > 1) {
          throw new WorkflowExecutionAlreadyStartedError(
            "already started",
            pending.workflowIdentity,
            "stateWorkflow",
          )
        }
        return "started" as const
      },
    }
    const source = { listWorkflowStarts: async () => [pending] }

    // When: reconciliation scans the same admitted-but-not-started intent twice.
    const first = await reconcileWorkflowStarts({ source, starter })
    const replay = await reconcileWorkflowStarts({ source, starter })

    // Then: the first scan starts it and the second classifies the collision as existing.
    expect(first).toEqual({ started: 1, existing: 0 })
    expect(replay).toEqual({ started: 0, existing: 1 })
    expect(attempts).toBe(2)
  })
})
