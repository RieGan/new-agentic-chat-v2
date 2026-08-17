import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow"

import { STATE_WORKFLOW_ACTIVITY_OPTIONS } from "./activity-options.js"
import type {
  AdminDecisionSignal,
  JobCompletionSignal,
  StateWorkflowActivities,
  StateWorkflowInput,
  StateWorkflowSignal,
  UserContinuationSignal,
  WorkflowInspectState,
} from "./contracts.js"
import {
  acceptCorrelatedSignal,
  applyWorkflowDirective,
  createInitialWorkflowState,
  signalIdempotencyKey,
  transitionWorkflowState,
} from "./state-machine.js"

export const adminDecisionSignal = defineSignal<[AdminDecisionSignal]>("adminDecision")
export const userContinuationSignal = defineSignal<[UserContinuationSignal]>("userContinuation")
export const jobCompletionSignal = defineSignal<[JobCompletionSignal]>("jobCompletion")
export const inspectStateQuery = defineQuery<WorkflowInspectState>("inspectState")

const activities = proxyActivities<StateWorkflowActivities>(STATE_WORKFLOW_ACTIVITY_OPTIONS)

const isTerminal = (state: WorkflowInspectState): boolean =>
  state.status === "completed" || state.status === "failed"

export const stateWorkflow = async (input: StateWorkflowInput): Promise<WorkflowInspectState> => {
  let state = createInitialWorkflowState(input)
  let acceptedSignal: StateWorkflowSignal | null = null

  const receiveSignal = (signal: StateWorkflowSignal): void => {
    if (acceptedSignal !== null) return
    acceptedSignal = acceptCorrelatedSignal(state, signal)
  }

  setHandler(adminDecisionSignal, receiveSignal)
  setHandler(userContinuationSignal, receiveSignal)
  setHandler(jobCompletionSignal, receiveSignal)
  setHandler(inspectStateQuery, () => state)

  await activities.reconcileStart({
    workflowId: input.workflowId,
    runId: input.runId,
    intentId: input.intentId,
    historyPosition: 1,
    idempotencyKey: `${input.workflowId}/start/${input.intentId}`,
  })
  state = transitionWorkflowState(state, { status: "running", wait: null })

  while (!isTerminal(state)) {
    const directive = await activities.advanceRun({
      workflowId: input.workflowId,
      runId: input.runId,
      historyPosition: state.historyPosition,
      idempotencyKey: `${input.workflowId}/advance/${state.historyPosition}`,
    })
    state = applyWorkflowDirective(state, directive)
    if (isTerminal(state)) break

    while (state.wait !== null) {
      await condition(() => acceptedSignal !== null)
      const signal = acceptedSignal
      if (signal === null) continue
      acceptedSignal = null
      const applied = await activities.applySignal({
        workflowId: input.workflowId,
        runId: input.runId,
        historyPosition: state.historyPosition,
        idempotencyKey: signalIdempotencyKey(input.workflowId, signal),
        signal,
      })
      if (applied === "ignored") continue
      state = transitionWorkflowState(state, { status: "running", wait: null })
    }
  }

  return state
}
