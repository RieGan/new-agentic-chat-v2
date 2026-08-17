import type { DatabaseClient } from "@agentic-chat/db"
import { reconcileStateWorkflowStart } from "@agentic-chat/db"
import type { ToolRegistry } from "@agentic-chat/tools"

import type { Clock } from "../application/dependencies.js"
import type { ReportJobQueue } from "../application/report-jobs.js"
import type { ModelProvider } from "../provider/contracts.js"
import { runStateWorkflowActivity } from "./activity-runner.js"
import { applyStateWorkflowSignal } from "./activity-signals.js"
import type { StateWorkflowActivityAdapter } from "./contracts.js"

export type StateWorkflowActivityDependencies = {
  readonly database: DatabaseClient
  readonly clock: Clock
  readonly provider: ModelProvider
  readonly tools: ToolRegistry
  readonly timeoutMs: number
  readonly durableWaits?: {
    readonly namespace: string
    readonly reportQueue: ReportJobQueue
    readonly approvalTtlMs?: number
  }
}

export const createStateWorkflowActivityAdapter = (
  dependencies: StateWorkflowActivityDependencies,
): StateWorkflowActivityAdapter => ({
  reconcileStartOnce: async (input) => {
    await reconcileStateWorkflowStart(dependencies.database, {
      runId: input.runId,
      workflowId: input.workflowId,
      intentId: input.intentId,
      occurredAt: dependencies.clock.now(),
    })
  },
  advanceRunOnce: (input) => runStateWorkflowActivity(dependencies, input),
  applySignalOnce: (input) => applyStateWorkflowSignal(dependencies, input),
})
