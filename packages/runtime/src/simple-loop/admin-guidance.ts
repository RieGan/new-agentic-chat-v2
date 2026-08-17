import { AdminCommandIdSchema, parseContract } from "@agentic-chat/contracts"
import { readAdminCommand, readPendingAdminCommand } from "@agentic-chat/db"

import { createAdminCommandService } from "../application/admin-commands.js"
import type { ProviderMessage } from "../provider/contracts.js"
import type { SimpleLoopDependencies } from "./runtime.js"
import type { MutableLoopState } from "./tools.js"

export const prepareAdminGuidance = async (
  dependencies: SimpleLoopDependencies,
  state: MutableLoopState,
  runId: string,
  messages: readonly ProviderMessage[],
): Promise<readonly ProviderMessage[]> => {
  state.messages = messages.filter((message) => message.role !== "system")
  const command =
    state.guidanceCommandId === undefined
      ? await readPendingAdminCommand(dependencies.database, runId)
      : await readAdminCommand(dependencies.database, {
          runId,
          commandId: state.guidanceCommandId,
        })
  if (command === null) return state.messages
  if (state.guidanceCommandId === undefined) {
    await createAdminCommandService(dependencies).applyAtBoundary({
      runId,
      commandId: command.id,
      boundary: "before_model",
    })
    state.guidanceCommandId = parseContract(AdminCommandIdSchema, command.id)
  }
  return [{ role: "system", content: command.instruction }, ...state.messages]
}
