import type { StateWorkflowActivities, StateWorkflowActivityAdapter } from "./contracts.js"

export const createStateWorkflowActivities = (
  adapter: StateWorkflowActivityAdapter,
): StateWorkflowActivities => ({
  reconcileStart: (input) => adapter.reconcileStartOnce(input),
  advanceRun: (input) => adapter.advanceRunOnce(input),
  applySignal: (input) => adapter.applySignalOnce(input),
})
