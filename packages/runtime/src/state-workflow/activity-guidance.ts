import { AdminCommandIdSchema, parseContract } from "@agentic-chat/contracts"
import { readAdminCommand } from "@agentic-chat/db"

import { createAdminCommandService } from "../application/admin-commands.js"
import type { ProviderMessage } from "../provider/contracts.js"
import type { StateWorkflowActivityDependencies } from "./activity-adapter.js"
import { type MutableStateWorkflowRun, stableActivityId } from "./activity-support.js"
import type { AdvanceRunActivityInput } from "./contracts.js"

export const prepareStateWorkflowAdminGuidance = async (
  dependencies: StateWorkflowActivityDependencies,
  input: AdvanceRunActivityInput,
  state: MutableStateWorkflowRun,
  conversationId: string,
  messages: readonly ProviderMessage[],
): Promise<readonly ProviderMessage[]> => {
  state.messages = messages.filter((message) => message.role !== "system")
  if (state.guidanceCommandId === undefined) {
    const nextStep = state.consumedSteps + 1
    const claimed = await createAdminCommandService({
      database: dependencies.database,
      clock: dependencies.clock,
      ids: {
        next: (kind) => stableActivityId("event", `${input.idempotencyKey}/${kind}/${nextStep}`),
      },
    }).claimAtBoundary({
      runId: input.runId,
      boundaryKey: `${input.idempotencyKey}/before_model/step/${nextStep}`,
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
