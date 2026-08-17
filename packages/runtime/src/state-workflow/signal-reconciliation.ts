import {
  type DatabaseClient,
  listPendingStateWorkflowSignals,
  markStateWorkflowSignalDispatched,
} from "@agentic-chat/db"
import type { WorkflowClient } from "@temporalio/client"
import { z } from "zod"

import type { Clock } from "../application/dependencies.js"
import type { StateWorkflowSignal } from "./contracts.js"
import { adminDecisionSignal, jobCompletionSignal, userContinuationSignal } from "./workflows.js"

const StateWorkflowSignalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("admin_decision"),
      runId: z.string().trim().min(1),
      callId: z.string().trim().min(1),
      approvalId: z.string().trim().min(1),
      decision: z.enum(["approved", "rejected"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("user_continuation"),
      runId: z.string().trim().min(1),
      correlationId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("job_completion"),
      runId: z.string().trim().min(1),
      callId: z.string().trim().min(1),
      jobId: z.string().trim().min(1),
      outcome: z.enum(["completed", "failed"]),
    })
    .strict(),
])

type ReconcileStateWorkflowSignalsInput = {
  readonly database: DatabaseClient
  readonly workflowClient: WorkflowClient
  readonly clock: Clock
}

export const reconcileStateWorkflowSignals = async (
  input: ReconcileStateWorkflowSignalsInput,
): Promise<{ readonly signaled: number }> => {
  const pending = await listPendingStateWorkflowSignals(input.database)
  let signaled = 0
  for (const intent of pending) {
    const signal: StateWorkflowSignal = StateWorkflowSignalSchema.parse(intent.payload)
    if (signal.runId !== intent.runId) continue
    const handle = input.workflowClient.getHandle(intent.workflowIdentity)
    switch (signal.kind) {
      case "admin_decision":
        await handle.signal(adminDecisionSignal, signal)
        break
      case "user_continuation":
        await handle.signal(userContinuationSignal, signal)
        break
      case "job_completion":
        await handle.signal(jobCompletionSignal, signal)
        break
      default: {
        const exhaustiveSignal: never = signal
        return exhaustiveSignal
      }
    }
    await markStateWorkflowSignalDispatched(input.database, {
      intentId: intent.intentId,
      dispatchedAt: input.clock.now(),
    })
    signaled += 1
  }
  return { signaled }
}
