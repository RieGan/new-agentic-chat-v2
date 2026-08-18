import type { Runtime } from "@agentic-chat/contracts"
import { useState } from "react"

import { useConversationSessions } from "./use-conversation-sessions.js"
import { useUserRun } from "./use-user-run.js"

export const useUserChat = () => {
  const [runtime, setRuntime] = useState<Runtime>("simple_loop")
  const run = useUserRun(runtime)
  const sessions = useConversationSessions(run.selectConversation)

  return {
    runtime,
    setRuntime,
    conversations: sessions.conversations,
    selectedConversationId: run.selectedConversationId,
    selectConversation: run.selectConversation,
    createConversation: sessions.createConversation,
    sessionsBusy: sessions.busy,
    conversation: run.conversation,
    projection: run.projection,
    events: run.events,
    connection: run.connection,
    notice: run.notice,
    error: sessions.error ?? run.error,
    busy: run.busy,
    send: run.send,
  }
}
