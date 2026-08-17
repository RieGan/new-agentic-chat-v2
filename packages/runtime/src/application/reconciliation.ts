import {
  type DatabaseClient,
  listPendingDispatches,
  listPendingWorkflowStarts,
} from "@agentic-chat/db"
import { z } from "zod"

const workflowStartSchema = z
  .object({
    intentId: z.string().min(1),
    runId: z.string().min(1),
    runtime: z.literal("state_workflow"),
    workflowIdentity: z.string().startsWith("agent-run/"),
    payload: z.json(),
  })
  .strict()
const pendingDispatchSchema = z
  .object({ intentId: z.string().min(1), topic: z.string().min(1), payload: z.json() })
  .strict()

export const createReconciliationService = (database: DatabaseClient) => ({
  listWorkflowStarts: async () =>
    z.array(workflowStartSchema).parse(await listPendingWorkflowStarts(database)),
  listPendingWork: async () =>
    z.array(pendingDispatchSchema).parse(await listPendingDispatches(database)),
})
