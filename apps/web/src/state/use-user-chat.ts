import type { Runtime } from "@agentic-chat/contracts"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  type ConnectionState,
  requestsCanonicalRefetch,
  type StreamFrame,
  userApi,
} from "../api/client.js"

type UserRun = Awaited<ReturnType<(typeof userApi)["run"]>>
type Conversation = Awaited<ReturnType<(typeof userApi)["conversation"]>>

const CONVERSATION_ID = "conversation_ui_mvp"

export type UserChatState = {
  readonly runtime: Runtime
  readonly setRuntime: (runtime: Runtime) => void
  readonly conversation: Conversation | undefined
  readonly projection: UserRun | undefined
  readonly events: readonly StreamFrame[]
  readonly connection: ConnectionState
  readonly notice: string
  readonly error: string | undefined
  readonly busy: boolean
  readonly send: (message: string) => Promise<boolean>
}

export const useUserChat = (): UserChatState => {
  const [runtime, setRuntime] = useState<Runtime>("simple_loop")
  const [runId, setRunId] = useState<string>()
  const [conversation, setConversation] = useState<Conversation>()
  const [projection, setProjection] = useState<UserRun>()
  const [events, setEvents] = useState<readonly StreamFrame[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [notice, setNotice] = useState("No active run")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const receivedIds = useRef(new Set<string>())

  const reportBoundaryError = useCallback(() => {
    setError("The live projection could not be read. Retry by sending the message again.")
    setConnection("disconnected")
  }, [])

  const refresh = useCallback(async (selectedRunId: string) => {
    const nextProjection = await userApi.run({ runId: selectedRunId })
    const nextConversation = await userApi.conversation({ conversationId: CONVERSATION_ID })
    setConversation(nextConversation)
    setProjection(nextProjection)
    const canonicalFrames: StreamFrame[] = []
    for (const event of nextProjection.events) {
      if (receivedIds.current.has(event.eventId)) continue
      receivedIds.current.add(event.eventId)
      canonicalFrames.push({ id: event.eventId, event })
    }
    if (canonicalFrames.length > 0) {
      setEvents((current) => [...current, ...canonicalFrames])
    }
    setNotice(`Run ${nextProjection.run.status.replaceAll("_", " ")}`)
  }, [])

  const receive = useCallback(
    (frame: StreamFrame) => {
      if (receivedIds.current.has(frame.event.eventId)) return
      receivedIds.current.add(frame.event.eventId)
      setEvents((current) => [...current, frame])
      if (runId !== undefined) void refresh(runId).catch(reportBoundaryError)
    },
    [refresh, reportBoundaryError, runId],
  )

  useEffect(() => {
    if (runId === undefined || projection === undefined) return
    const subscription = userApi.subscribe(
      { runId, cursor: projection.run.cursor },
      {
        onConnection: setConnection,
        onEvent: receive,
        onError: (streamError) => {
          if (requestsCanonicalRefetch(streamError)) {
            setConnection("connecting")
            setNotice("Recovering canonical state")
            void refresh(runId)
              .then(() => setNotice("Canonical state recovered"))
              .catch(reportBoundaryError)
            return
          }
          reportBoundaryError()
        },
      },
    )
    return () => subscription.unsubscribe()
  }, [projection, receive, refresh, reportBoundaryError, runId])

  const send = useCallback(
    async (message: string): Promise<boolean> => {
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
                conversationId: CONVERSATION_ID,
                runId: projection.run.runId,
                boundary: "waiting_for_user" as const,
                correlationId: waitingEvent.correlationId,
                message,
                idempotencyKey: crypto.randomUUID(),
              }
            : {
                kind: "new_run" as const,
                conversationId: CONVERSATION_ID,
                runtime,
                message,
                idempotencyKey: crypto.randomUUID(),
              }
        const receipt = await userApi.sendMessage(input)
        receivedIds.current = new Set<string>()
        setEvents([])
        setProjection(undefined)
        setRunId(receipt.runId)
        setNotice("Command accepted. Loading persisted projection")
        await refresh(receipt.runId)
        return true
      } catch {
        reportBoundaryError()
        return false
      } finally {
        setBusy(false)
      }
    },
    [events, projection, refresh, reportBoundaryError, runtime],
  )

  return {
    runtime,
    setRuntime,
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
