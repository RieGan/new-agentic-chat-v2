import type { ConversationId } from "@agentic-chat/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import { userApi } from "../api/client.js"

export type ConversationSummary = Awaited<
  ReturnType<(typeof userApi)["listConversations"]>
>["conversations"][number]

type ConversationSessions = {
  readonly conversations: readonly ConversationSummary[]
  readonly busy: boolean
  readonly error: string | undefined
  readonly createConversation: () => Promise<boolean>
}

export const useConversationSessions = (
  selectConversation: (conversationId: ConversationId) => void,
): ConversationSessions => {
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const initialized = useRef(false)

  const createConversation = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      const created = await userApi.createConversation({
        conversationId: `conversation_${crypto.randomUUID()}`,
      })
      setConversations((current) => [
        created,
        ...current.filter((item) => item.conversationId !== created.conversationId),
      ])
      selectConversation(created.conversationId)
      return true
    } catch {
      setError("A new session could not be created.")
      return false
    } finally {
      setBusy(false)
    }
  }, [selectConversation])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void userApi
      .listConversations({})
      .then(async ({ conversations: loaded }) => {
        setConversations(loaded)
        const first = loaded[0]
        if (first === undefined) {
          await createConversation()
          return
        }
        selectConversation(first.conversationId)
        setBusy(false)
      })
      .catch(() => {
        setError("Sessions could not be loaded.")
        setBusy(false)
      })
  }, [createConversation, selectConversation])

  return { conversations, busy, error, createConversation }
}
