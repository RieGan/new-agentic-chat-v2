import { AdminCommandIdSchema, parseContract } from "@agentic-chat/contracts"
import { readAdminCommand } from "@agentic-chat/db"

import { createAdminCommandService } from "../application/admin-commands.js"
import type { ProviderMessage } from "../provider/contracts.js"
import type { SimpleLoopDependencies } from "./runtime.js"
import type { MutableLoopState } from "./tools.js"

export const prepareAdminGuidance = async (
  dependencies: SimpleLoopDependencies,
  state: MutableLoopState,
  runId: string,
  conversationId: string,
  messages: readonly ProviderMessage[],
): Promise<readonly ProviderMessage[]> => {
  state.messages = messages.filter((message) => message.role !== "system")
  if (state.guidanceCommandId === undefined) {
    const claimed = await createAdminCommandService(dependencies).claimAtBoundary({
      runId,
      boundaryKey: `${runId}/before_model/step/${state.consumedSteps + 1}`,
    })
    if (claimed === null) return state.messages
    state.guidanceCommandId = parseContract(AdminCommandIdSchema, claimed.command.commandId)
    return [{ role: "system", content: claimed.instruction }, ...state.messages]
  }
  const command = await readAdminCommand(dependencies.database, {
    conversationId,
    commandId: state.guidanceCommandId,
  })
  if (command === null) return state.messages
  return [{ role: "system", content: command.instruction }, ...state.messages]
}
