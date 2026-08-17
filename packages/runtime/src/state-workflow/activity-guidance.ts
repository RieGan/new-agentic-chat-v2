import { AdminCommandIdSchema, parseContract } from "@agentic-chat/contracts"
import { readAdminCommand, readPendingAdminCommand } from "@agentic-chat/db"

import { createAdminCommandService } from "../application/admin-commands.js"
import type { ProviderMessage } from "../provider/contracts.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import { type MutableStateWorkflowRun, stableActivityId } from "./activity-support.js"
import type { AdvanceRunActivityInput } from "./contracts.js"

export const prepareStateWorkflowAdminGuidance = async (
  dependencies: StateWorkflowActivityDependencies,
  input: AdvanceRunActivityInput,
  state: MutableStateWorkflowRun,
  messages: readonly ProviderMessage[],
): Promise<readonly ProviderMessage[]> => {
  state.messages = messages.filter((message) => message.role !== "system")
  const command =
    state.guidanceCommandId === undefined
      ? await readPendingAdminCommand(dependencies.database, input.runId)
      : await readAdminCommand(dependencies.database, {
          runId: input.runId,
          commandId: state.guidanceCommandId,
        })
  if (command === null) return state.messages
  if (state.guidanceCommandId === undefined) {
    await createAdminCommandService({
      database: dependencies.database,
      clock: dependencies.clock,
      ids: {
        next: (kind) => stableActivityId("event", `${input.idempotencyKey}/${kind}/${command.id}`),
      },
    }).applyAtBoundary({ runId: input.runId, commandId: command.id, boundary: "before_model" })
    state.guidanceCommandId = parseContract(AdminCommandIdSchema, command.id)
  }
  return [{ role: "system", content: command.instruction }, ...state.messages]
}
