import { useCallback, useEffect, useRef, useState } from "react"

import {
  adminApi,
  type ConnectionState,
  requestsCanonicalRefetch,
  type StreamFrame,
} from "../api/client.js"

type RunList = Awaited<ReturnType<(typeof adminApi)["runs"]>>
type AdminRun = Awaited<ReturnType<(typeof adminApi)["run"]>>
type ConversationList = Awaited<ReturnType<(typeof adminApi)["listConversations"]>>["conversations"]

export type AdminRunsState = {
  readonly conversations: ConversationList
  readonly selectedConversationId: string | undefined
  readonly selectConversation: (conversationId: string) => void
  readonly runs: RunList
  readonly selectedRunId: string | undefined
  readonly selectRun: (runId: string) => void
  readonly projection: AdminRun | undefined
  readonly events: readonly StreamFrame[]
  readonly connection: ConnectionState
  readonly notice: string
  readonly error: string | undefined
  readonly sending: boolean
  readonly sendHidden: (instruction: string) => Promise<boolean>
}

export const useAdminRuns = (): AdminRunsState => {
  const [conversations, setConversations] = useState<ConversationList>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string>()
  const [runs, setRuns] = useState<RunList>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [projection, setProjection] = useState<AdminRun>()
  const [events, setEvents] = useState<readonly StreamFrame[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [notice, setNotice] = useState("Loading runs")
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const receivedIds = useRef(new Set<string>())
  const selectedConversationRef = useRef<string | undefined>(undefined)
  const selectedRunRef = useRef<string | undefined>(undefined)
  const projectionRequest = useRef(0)

  const selectConversation = useCallback((conversationId: string) => {
    selectedConversationRef.current = conversationId
    setSelectedConversationId(conversationId)
  }, [])

  const selectRun = useCallback((runId: string) => {
    if (selectedRunRef.current === runId) return
    selectedRunRef.current = runId
    projectionRequest.current += 1
    receivedIds.current = new Set<string>()
    setSelectedRunId(runId)
    setProjection(undefined)
    setEvents([])
  }, [])

  const loadConversations = useCallback(async () => {
    const loaded = (await adminApi.listConversations({})).conversations
    setConversations(loaded)
    const first = loaded[0]
    if (selectedConversationRef.current === undefined && first !== undefined) {
      selectConversation(first.conversationId)
    }
    return loaded
  }, [selectConversation])

  const loadRuns = useCallback(async () => {
    const loaded = await adminApi.runs({})
    setRuns(loaded)
    const first = loaded[0]
    if (selectedRunRef.current === undefined && first !== undefined) selectRun(first.runId)
    return loaded
  }, [selectRun])

  const loadRun = useCallback(async (runId: string) => {
    const request = projectionRequest.current + 1
    projectionRequest.current = request
    const loaded = await adminApi.run({ runId })
    if (selectedRunRef.current !== runId || request !== projectionRequest.current) return
    setProjection(loaded)
    setEvents(loaded.events.map((event) => ({ id: event.eventId, event })))
    receivedIds.current = new Set(loaded.events.map((event) => event.eventId))
  }, [])

  useEffect(() => {
    void Promise.all([loadRuns(), loadConversations()])
      .then(([loadedRuns, loadedConversations]) => {
        setNotice(
          `${loadedRuns.length} runs loaded · ${loadedConversations.length} sessions available`,
        )
      })
      .catch(() => setError("Admin sessions and runs are unavailable."))
  }, [loadConversations, loadRuns])

  useEffect(() => {
    if (selectedRunId === undefined) return
    void loadRun(selectedRunId).catch(() => setError("Run projection unavailable."))
  }, [loadRun, selectedRunId])

  useEffect(() => {
    if (selectedRunId === undefined || projection === undefined) return
    const subscription = adminApi.subscribeRun(
      { runId: selectedRunId, cursor: projection.run.cursor },
      {
        onConnection: setConnection,
        onEvent: (frame) => {
          if (selectedRunRef.current !== selectedRunId) return
          if (receivedIds.current.has(frame.event.eventId)) return
          receivedIds.current.add(frame.event.eventId)
          setEvents((current) => [...current, frame])
          void Promise.all([loadRun(selectedRunId), loadRuns()])
        },
        onError: (streamError) => {
          if (selectedRunRef.current !== selectedRunId) return
          if (requestsCanonicalRefetch(streamError)) {
            setNotice("Recovering canonical state")
            void loadRun(selectedRunId).then(() => setNotice("Canonical state recovered"))
            return
          }
          setError("Live run connection unavailable.")
        },
      },
    )
    return () => subscription.unsubscribe()
  }, [loadRun, loadRuns, projection, selectedRunId])

  const sendHidden = useCallback(async (instruction: string): Promise<boolean> => {
    const conversationId = selectedConversationRef.current
    if (conversationId === undefined) return false
    setSending(true)
    setError(undefined)
    try {
      await adminApi.sendHidden({
        conversationId,
        instruction,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        idempotencyKey: crypto.randomUUID(),
      })
      if (selectedConversationRef.current === conversationId) {
        setNotice("Hidden command accepted for the next model boundary")
      }
      return true
    } catch {
      setError("Hidden command was not accepted. Check the selected session.")
      return false
    } finally {
      setSending(false)
    }
  }, [])

  return {
    conversations,
    selectedConversationId,
    selectConversation,
    runs,
    selectedRunId,
    selectRun,
    projection,
    events,
    connection,
    notice,
    error,
    sending,
    sendHidden,
  }
}
