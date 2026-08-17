import { CallIdSchema, ToolNameSchema } from "@agentic-chat/contracts"
import { persistSimpleLoopToolOutcome } from "@agentic-chat/db"

import type { SimpleLoopDependencies } from "./runtime.js"
import { type ActiveSimpleLoopRun, mutationIdentity } from "./runtime-session.js"
import { contextValue } from "./runtime-support.js"
import { hashToolArguments, type MutableLoopState } from "./tools.js"

export const persistMappedToolFailure = async (
  dependencies: SimpleLoopDependencies,
  active: ActiveSimpleLoopRun,
  state: MutableLoopState,
  mapped: ReturnType<typeof import("./runtime-support.js").mapAgentFailure>,
): Promise<void> => {
  if (mapped.toolName === undefined || mapped.toolName === "skill.load") return
  const persisted = await persistSimpleLoopToolOutcome(dependencies.database, {
    ...mutationIdentity(active, state),
    eventId: active.ids.next("event"),
    terminalEventId: active.ids.next("event"),
    correlationId: active.ids.next("correlation"),
    callId: CallIdSchema.parse(active.ids.next("call")),
    toolName: ToolNameSchema.parse(mapped.toolName),
    arguments: {},
    argumentsHash: hashToolArguments({}),
    context: contextValue(state),
    outcome: {
      status: mapped.error.code === "TOOL_NOT_ALLOWED" ? "rejected" : "failed",
      error: mapped.error,
    },
  })
  state.version = persisted.version
}
