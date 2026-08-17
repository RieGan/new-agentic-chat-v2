import { type NativeConnection, Worker } from "@temporalio/worker"

import type { StateWorkflowActivities } from "./contracts.js"

export const STATE_WORKFLOW_TASK_QUEUE = "agentic-chat-state-workflow" as const

export type StateWorkflowWorkerInput = {
  readonly connection: NativeConnection
  readonly namespace: string
  readonly taskQueue?: string
  readonly workflowsPath: string
  readonly activities: StateWorkflowActivities
}

export const createStateWorkflowWorker = (input: StateWorkflowWorkerInput): Promise<Worker> =>
  Worker.create({
    connection: input.connection,
    namespace: input.namespace,
    taskQueue: input.taskQueue ?? STATE_WORKFLOW_TASK_QUEUE,
    workflowsPath: input.workflowsPath,
    activities: input.activities,
  })
