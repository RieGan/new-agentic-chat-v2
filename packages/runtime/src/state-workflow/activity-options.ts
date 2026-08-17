import type { ActivityOptions } from "@temporalio/workflow"

export const STATE_WORKFLOW_ACTIVITY_OPTIONS = {
  scheduleToCloseTimeout: "2 minutes",
  startToCloseTimeout: "30 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 3,
    nonRetryableErrorTypes: ["StateWorkflowConflictError"],
  },
} as const satisfies ActivityOptions
