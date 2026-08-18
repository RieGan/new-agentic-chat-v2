import type { ConversationId, Runtime } from "@agentic-chat/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  type ConnectionState,
  requestsCanonicalRefetch,
  type StreamFrame,
  userApi,
} from "../api/client.js"

type UserRun = Awaited<ReturnType<(typeof userApi)["run"]>>
type Conversation = Awaited<ReturnType<(typeof userApi)["conversation"]>>

export type UserRunState = {
  readonly selectedConversationId: ConversationId | undefined
  readonly selectConversation: (conversationId: ConversationId) => void
  readonly conversation: Conversation | undefined
  readonly projection: UserRun | undefined
  readonly events: readonly StreamFrame[]
  readonly connection: ConnectionState
  readonly notice: string
  readonly error: string | undefined
  readonly busy: boolean
  readonly send: (message: string) => Promise<boolean>
}

export const useUserRun = (runtime: Runtime): UserRunState => {
  const [selectedConversationId, setSelectedConversationId] = useState<ConversationId>()
  const [runId, setRunId] = useState<string>()
  const [conversation, setConversation] = useState<Conversation>()
  const [projection, setProjection] = useState<UserRun>()
  const [events, setEvents] = useState<readonly StreamFrame[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [notice, setNotice] = useState("Loading sessions")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const selectedConversation = useRef<ConversationId | undefined>(undefined)
  const selectedRun = useRef<string | undefined>(undefined)
  const epoch = useRef(0)
  const receivedIds = useRef(new Set<string>())

  const isCurrent = useCallback(
    (conversationId: ConversationId, requestEpoch: number) =>
      selectedConversation.current === conversationId && epoch.current === requestEpoch,
    [],
  )

  const reportBoundaryError = useCallback((requestEpoch: number) => {
    if (epoch.current !== requestEpoch) return
    setError("The live projection could not be read. Retry by sending the message again.")
    setConnection("disconnected")
  }, [])

  const loadRun = useCallback(
    async (conversationId: ConversationId, nextRunId: string, requestEpoch: number) => {
      const nextProjection = await userApi.run({ runId: nextRunId })
      if (!isCurrent(conversationId, requestEpoch) || selectedRun.current !== nextRunId) return
      setProjection(nextProjection)
      setEvents(nextProjection.events.map((event) => ({ id: event.eventId, event })))
      receivedIds.current = new Set(nextProjection.events.map((event) => event.eventId))
      setNotice(`Run ${nextProjection.run.status.replaceAll("_", " ")}`)
    },
    [isCurrent],
  )

  const loadConversation = useCallback(
    async (conversationId: ConversationId, requestEpoch: number) => {
      const loaded = await userApi.conversation({ conversationId })
      if (!isCurrent(conversationId, requestEpoch)) return
      setConversation(loaded)
      const latestRun = loaded.runs.at(-1)
      if (latestRun === undefined) {
        selectedRun.current = undefined
        setRunId(undefined)
        setNotice("No active run")
        return
      }
      selectedRun.current = latestRun.runId
      setRunId(latestRun.runId)
      await loadRun(conversationId, latestRun.runId, requestEpoch)
    },
    [isCurrent, loadRun],
  )

  const refresh = useCallback(
    async (conversationId: ConversationId, nextRunId: string, requestEpoch: number) => {
      const [nextProjection, nextConversation] = await Promise.all([
        userApi.run({ runId: nextRunId }),
        userApi.conversation({ conversationId }),
      ])
      if (!isCurrent(conversationId, requestEpoch) || selectedRun.current !== nextRunId) return
      setConversation(nextConversation)
      setProjection(nextProjection)
      setEvents(nextProjection.events.map((event) => ({ id: event.eventId, event })))
      receivedIds.current = new Set(nextProjection.events.map((event) => event.eventId))
      setNotice(`Run ${nextProjection.run.status.replaceAll("_", " ")}`)
    },
    [isCurrent],
  )

  const selectConversation = useCallback(
    (conversationId: ConversationId) => {
      if (selectedConversation.current === conversationId) return
      epoch.current += 1
      const requestEpoch = epoch.current
      selectedConversation.current = conversationId
      selectedRun.current = undefined
      receivedIds.current = new Set<string>()
      setSelectedConversationId(conversationId)
      setRunId(undefined)
      setConversation(undefined)
      setProjection(undefined)
      setEvents([])
      setConnection("disconnected")
      setNotice("Loading session")
      setError(undefined)
      setBusy(false)
      void loadConversation(conversationId, requestEpoch).catch(() =>
        reportBoundaryError(requestEpoch),
      )
    },
    [loadConversation, reportBoundaryError],
  )

  useEffect(() => {
    if (selectedConversationId === undefined || runId === undefined || projection === undefined) {
      return
    }
    const requestEpoch = epoch.current
    const subscription = userApi.subscribe(
      { runId, cursor: projection.run.cursor },
      {
        onConnection: (state) => {
          if (isCurrent(selectedConversationId, requestEpoch)) setConnection(state)
        },
        onEvent: (frame) => {
          if (!isCurrent(selectedConversationId, requestEpoch) || selectedRun.current !== runId)
            return
          if (receivedIds.current.has(frame.event.eventId)) return
          receivedIds.current.add(frame.event.eventId)
          setEvents((current) => [...current, frame])
          void refresh(selectedConversationId, runId, requestEpoch).catch(() =>
            reportBoundaryError(requestEpoch),
          )
        },
        onError: (streamError) => {
          if (!isCurrent(selectedConversationId, requestEpoch)) return
          if (requestsCanonicalRefetch(streamError)) {
            setConnection("connecting")
            setNotice("Recovering canonical state")
            void refresh(selectedConversationId, runId, requestEpoch)
              .then(() => {
                if (isCurrent(selectedConversationId, requestEpoch)) {
                  setNotice("Canonical state recovered")
                }
              })
              .catch(() => reportBoundaryError(requestEpoch))
            return
          }
          reportBoundaryError(requestEpoch)
        },
      },
    )
    return () => subscription.unsubscribe()
  }, [isCurrent, projection, refresh, reportBoundaryError, runId, selectedConversationId])

  const send = useCallback(
    async (message: string): Promise<boolean> => {
      const conversationId = selectedConversation.current
      if (conversationId === undefined) return false
      const requestEpoch = epoch.current
      setBusy(true)
      setError(undefined)
      try {
        const waitingEvent = events
          .map((frame) => frame.event)
          .findLast((event) => event.type === "run.status_changed")
        const input =
          projection?.run.status === "waiting_for_user" && waitingEvent !== undefined
            ? {
                kind: "continue_run" as const,
                conversationId,
                runId: projection.run.runId,
                boundary: "waiting_for_user" as const,
                correlationId: waitingEvent.correlationId,
                message,
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                kind: "new_run" as const,
                conversationId,
                runtime,
                message,
                idempotencyKey: crypto.randomUUID(),
              }
        const receipt = await userApi.sendMessage(input)
        if (!isCurrent(conversationId, requestEpoch)) return false
        receivedIds.current = new Set<string>()
        selectedRun.current = receipt.runId
        setEvents([])
        setProjection(undefined)
        setRunId(receipt.runId)
        setNotice("Command accepted. Loading persisted projection")
        await refresh(conversationId, receipt.runId, requestEpoch)
        return isCurrent(conversationId, requestEpoch)
      } catch {
        reportBoundaryError(requestEpoch)
        return false
      } finally {
        if (isCurrent(conversationId, requestEpoch)) setBusy(false)
      }
    },
    [events, isCurrent, projection, refresh, reportBoundaryError, runtime],
  )

  return {
    selectedConversationId,
    selectConversation,
    conversation,
    projection,
    events,
    connection,
    notice,
    error,
    busy,
    send,
  }
}
