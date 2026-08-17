import { useCallback, useEffect, useRef, useState } from "react"

import {
  adminApi,
  type ConnectionState,
  requestsCanonicalRefetch,
  type StreamFrame,
} from "../api/client.js"

type RunList = Awaited<ReturnType<(typeof adminApi)["runs"]>>
type AdminRun = Awaited<ReturnType<(typeof adminApi)["run"]>>

export type AdminRunsState = {
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
  const [runs, setRuns] = useState<RunList>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [projection, setProjection] = useState<AdminRun>()
  const [events, setEvents] = useState<readonly StreamFrame[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [notice, setNotice] = useState("Loading runs")
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const receivedIds = useRef(new Set<string>())
  const selectedRunRef = useRef<string | undefined>(undefined)
  const projectionRequest = useRef(0)

  const selectRun = useCallback((runId: string) => {
    if (selectedRunRef.current === runId) return
    selectedRunRef.current = runId
    projectionRequest.current += 1
    receivedIds.current = new Set<string>()
    setSelectedRunId(runId)
    setProjection(undefined)
    setEvents([])
  }, [])

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
    void loadRuns()
      .then((loaded) =>
        setNotice(loaded.length === 0 ? "No runs available" : `${loaded.length} runs loaded`),
      )
      .catch(() => setError("Run list unavailable."))
  }, [loadRuns])

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

  const sendHidden = useCallback(
    async (instruction: string): Promise<boolean> => {
      const runId = selectedRunRef.current
      if (runId === undefined) return false
      setSending(true)
      setError(undefined)
      try {
        await adminApi.sendHidden({
          runId,
          instruction,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          idempotencyKey: crypto.randomUUID(),
        })
        if (selectedRunRef.current === runId) {
          setNotice("Hidden command accepted for the next model boundary")
        }
        await loadRun(runId)
        return true
      } catch {
        setError("Hidden command was not accepted. Check the selected run state.")
        return false
      } finally {
        setSending(false)
      }
    },
    [loadRun],
  )

  return {
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
