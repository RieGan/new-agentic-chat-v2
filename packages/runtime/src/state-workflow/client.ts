import { WorkflowExecutionAlreadyStartedError, type WorkflowStartOptions } from "@temporalio/client"
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from "@temporalio/common"

import type { PendingWorkflowStart, StateWorkflowInput } from "./contracts.js"
import { stateWorkflow } from "./workflows.js"

export const STATE_WORKFLOW_START_POLICIES = {
  workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
  workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
} as const

export const stateWorkflowId = (runId: string): string => `agent-run/${runId}`

export class StateWorkflowIdentityError extends Error {
  readonly name = "StateWorkflowIdentityError"

  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`State Workflow identity mismatch: expected ${expected}, received ${actual}`)
  }
}

export interface StateWorkflowStartSource {
  listWorkflowStarts(): Promise<readonly PendingWorkflowStart[]>
}

export interface StateWorkflowStarter {
  start(intent: PendingWorkflowStart): Promise<"started" | "existing">
}

interface WorkflowStartPort {
  start(
    workflow: typeof stateWorkflow,
    options: WorkflowStartOptions<typeof stateWorkflow>,
  ): Promise<{ readonly workflowId: string }>
}

type TemporalStarterInput = {
  readonly workflowClient: WorkflowStartPort
  readonly taskQueue: string
}

const assertWorkflowIdentity = (intent: PendingWorkflowStart): void => {
  const expected = stateWorkflowId(intent.runId)
  if (intent.workflowIdentity !== expected) {
    throw new StateWorkflowIdentityError(expected, intent.workflowIdentity)
  }
}

export const createTemporalWorkflowStarter = (
  input: TemporalStarterInput,
): StateWorkflowStarter => ({
  start: async (intent) => {
    assertWorkflowIdentity(intent)
    const workflowInput = {
      workflowId: intent.workflowIdentity,
      runId: intent.runId,
      intentId: intent.intentId,
    } as const satisfies StateWorkflowInput
    try {
      await input.workflowClient.start(stateWorkflow, {
        workflowId: intent.workflowIdentity,
        taskQueue: input.taskQueue,
        args: [workflowInput],
        ...STATE_WORKFLOW_START_POLICIES,
      })
      return "started"
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return "existing"
      throw error
    }
  },
})

type ReconcileWorkflowStartsInput = {
  readonly source: StateWorkflowStartSource
  readonly starter: StateWorkflowStarter
}

export const reconcileWorkflowStarts = async (
  input: ReconcileWorkflowStartsInput,
): Promise<{ readonly started: number; readonly existing: number }> => {
  let started = 0
  let existing = 0
  for (const intent of await input.source.listWorkflowStarts()) {
    try {
      const result = await input.starter.start(intent)
      if (result === "started") started += 1
      else existing += 1
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        existing += 1
        continue
      }
      throw error
    }
  }
  return { started, existing }
}
