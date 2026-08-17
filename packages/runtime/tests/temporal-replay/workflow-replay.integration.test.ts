import { fileURLToPath } from "node:url"

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client"
import { TestWorkflowEnvironment } from "@temporalio/testing"
import { Worker } from "@temporalio/worker"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { STATE_WORKFLOW_ACTIVITY_OPTIONS } from "../../src/state-workflow/activity-options.js"
import { STATE_WORKFLOW_START_POLICIES, stateWorkflowId } from "../../src/state-workflow/client.js"
import type { StateWorkflowActivities } from "../../src/state-workflow/contracts.js"
import {
  adminDecisionSignal,
  inspectStateQuery,
  jobCompletionSignal,
  stateWorkflow,
  userContinuationSignal,
} from "../../src/state-workflow/workflows.js"

describe("deterministic State Workflow history", () => {
  let environment: TestWorkflowEnvironment

  beforeAll(async () => {
    environment = await TestWorkflowEnvironment.createLocal()
  }, 120_000)

  afterAll(async () => {
    await environment.teardown()
  })

  it("executes correlated waits, retries idempotently, and replays without external I/O", async () => {
    // Given: real Temporal execution with one post-commit Activity failure.
    const workflowId = stateWorkflowId("run_replay")
    const taskQueue = "state-workflow-replay"
    const committedKeys = new Set<string>()
    let canonicalEffects = 0
    let startAttempts = 0
    let externalCalls = 0
    const commitOnce = (key: string): void => {
      if (committedKeys.has(key)) return
      committedKeys.add(key)
      canonicalEffects += 1
    }
    const activities: StateWorkflowActivities = {
      reconcileStart: async (input) => {
        externalCalls += 1
        startAttempts += 1
        commitOnce(input.idempotencyKey)
        if (startAttempts === 1) throw new TypeError("injected post-commit timeout")
      },
      applySignal: async (input) => {
        externalCalls += 1
        commitOnce(input.idempotencyKey)
        return "applied"
      },
      advanceRun: async (input) => {
        externalCalls += 1
        commitOnce(input.idempotencyKey)
        switch (input.historyPosition) {
          case 1:
            return { kind: "wait_for_admin", callId: "call_1", approvalId: "approval_1" }
          case 3:
            return { kind: "wait_for_user", correlationId: "correlation_1" }
          case 5:
            return { kind: "wait_for_job", callId: "call_1", jobId: "job_1" }
          case 7:
            return { kind: "complete" }
          default:
            return { kind: "fail" }
        }
      },
    }
    const signalKinds: StateWorkflowActivities["applySignal"] = async (input) => {
      switch (input.signal.kind) {
        case "admin_decision":
        case "user_continuation":
        case "job_completion":
          return activities.applySignal(input)
        default: {
          const exhaustiveSignal: never = input.signal
          return exhaustiveSignal
        }
      }
    }
    const registeredActivities: StateWorkflowActivities = {
      ...activities,
      applySignal: signalKinds,
    }
    const workflowsPath = fileURLToPath(
      new URL("../../src/state-workflow/workflows.ts", import.meta.url),
    )
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      ...(environment.namespace ? { namespace: environment.namespace } : {}),
      taskQueue,
      workflowsPath,
      activities: registeredActivities,
    })
    const workerRun = worker.run()

    try {
      // When: the run receives wrong and exact signals at each legal wait.
      const handle = await environment.client.workflow.start(stateWorkflow, {
        workflowId,
        taskQueue,
        args: [{ runId: "run_replay", intentId: "intent_replay", workflowId }],
        ...STATE_WORKFLOW_START_POLICIES,
      })
      await expect
        .poll(() => handle.query(inspectStateQuery), { timeout: 30_000 })
        .toMatchObject({ status: "waiting_for_admin", historyPosition: 2 })
      await expect(
        environment.client.workflow.start(stateWorkflow, {
          workflowId,
          taskQueue,
          args: [{ runId: "run_replay", intentId: "intent_replay", workflowId }],
          ...STATE_WORKFLOW_START_POLICIES,
        }),
      ).rejects.toBeInstanceOf(WorkflowExecutionAlreadyStartedError)
      const adminState = await handle.query(inspectStateQuery)
      await handle.signal(adminDecisionSignal, {
        kind: "admin_decision",
        runId: "run_wrong",
        callId: "call_1",
        approvalId: "approval_1",
        decision: "approved",
      })
      expect(await handle.query(inspectStateQuery)).toEqual(adminState)
      await handle.signal(adminDecisionSignal, {
        kind: "admin_decision",
        runId: "run_replay",
        callId: "call_1",
        approvalId: "approval_1",
        decision: "approved",
      })
      await expect
        .poll(() => handle.query(inspectStateQuery))
        .toMatchObject({ status: "waiting_for_user", historyPosition: 4 })
      const userState = await handle.query(inspectStateQuery)
      await handle.signal(userContinuationSignal, {
        kind: "user_continuation",
        runId: "run_replay",
        correlationId: "correlation_wrong",
      })
      expect(await handle.query(inspectStateQuery)).toEqual(userState)
      await handle.signal(userContinuationSignal, {
        kind: "user_continuation",
        runId: "run_replay",
        correlationId: "correlation_1",
      })
      await expect
        .poll(() => handle.query(inspectStateQuery))
        .toMatchObject({ status: "waiting_for_tool", historyPosition: 6 })
      const jobState = await handle.query(inspectStateQuery)
      await handle.signal(jobCompletionSignal, {
        kind: "job_completion",
        runId: "run_replay",
        callId: "call_wrong",
        jobId: "job_1",
        outcome: "completed",
      })
      expect(await handle.query(inspectStateQuery)).toEqual(jobState)
      await handle.signal(jobCompletionSignal, {
        kind: "job_completion",
        runId: "run_replay",
        callId: "call_1",
        jobId: "job_1",
        outcome: "completed",
      })
      await expect(handle.result()).resolves.toMatchObject({
        status: "completed",
        historyPosition: 8,
      })
      await expect(
        environment.client.workflow.start(stateWorkflow, {
          workflowId,
          taskQueue,
          args: [{ runId: "run_replay", intentId: "intent_replay", workflowId }],
          ...STATE_WORKFLOW_START_POLICIES,
        }),
      ).rejects.toBeInstanceOf(WorkflowExecutionAlreadyStartedError)
      await expect(
        handle.signal(userContinuationSignal, {
          kind: "user_continuation",
          runId: "run_replay",
          correlationId: "correlation_1",
        }),
      ).rejects.toBeDefined()
      const history = await handle.fetchHistory()
      const callsBeforeReplay = externalCalls

      // Then: retry shares one start effect and history replay invokes no Activity I/O.
      expect(STATE_WORKFLOW_ACTIVITY_OPTIONS.retry.maximumAttempts).toBe(3)
      expect(startAttempts).toBe(2)
      expect(canonicalEffects).toBe(8)
      await Worker.runReplayHistory({ workflowsPath }, history, workflowId)
      expect(externalCalls).toBe(callsBeforeReplay)
    } finally {
      worker.shutdown()
      await workerRun
    }
  }, 120_000)
})
