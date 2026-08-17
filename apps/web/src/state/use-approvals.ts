import { useCallback, useEffect, useRef, useState } from "react"

import { adminApi, type ConnectionState } from "../api/client.js"

type Approval = Awaited<ReturnType<(typeof adminApi)["approvals"]>>[number]

export type ApprovalsState = {
  readonly approvals: readonly Approval[]
  readonly connection: ConnectionState
  readonly error: string | undefined
  readonly decidingId: string | undefined
  readonly approve: (approval: Approval) => Promise<boolean>
  readonly reject: (approval: Approval, reason: string) => Promise<boolean>
}

export const useApprovals = (): ApprovalsState => {
  const [approvals, setApprovals] = useState<readonly Approval[]>([])
  const [connection, setConnection] = useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string>()
  const [decidingId, setDecidingId] = useState<string>()
  const mounted = useRef(false)
  const decidingIdRef = useRef<string | undefined>(undefined)
  const refreshVersion = useRef(0)
  const subscriptions = useRef(new Map<string, { readonly unsubscribe: () => void }>())
  const connectionByRun = useRef(new Map<string, ConnectionState>())
  const refreshRef = useRef<() => void>(() => {})

  const updateConnection = useCallback((runId: string, state: ConnectionState | undefined) => {
    if (state === undefined) connectionByRun.current.delete(runId)
    else connectionByRun.current.set(runId, state)
    const states = [...connectionByRun.current.values()]
    const subscriptionCount = subscriptions.current.size
    setConnection(
      subscriptionCount > 0 &&
        states.length === subscriptionCount &&
        states.every((candidate) => candidate === "connected")
        ? "connected"
        : states.includes("connecting") || states.length < subscriptionCount
          ? "connecting"
          : "disconnected",
    )
  }, [])

  const load = useCallback(async () => {
    const version = refreshVersion.current + 1
    refreshVersion.current = version
    const pending = await adminApi.approvals({})
    if (!mounted.current || version !== refreshVersion.current) return
    setApprovals((current) => {
      const pendingIds = new Set(pending.map((approval) => approval.approvalId))
      const retained = current.filter(
        (approval) =>
          !pendingIds.has(approval.approvalId) &&
          (approval.status !== "pending" || approval.approvalId === decidingIdRef.current),
      )
      return [...pending, ...retained]
    })
  }, [])

  const reconcileSubscriptions = useCallback(async () => {
    const runs = await adminApi.runs({})
    if (!mounted.current) return
    const eligibleRuns = runs.filter((run) => run.status !== "completed" && run.status !== "failed")
    const eligibleRunIds = new Set<string>(eligibleRuns.map((run) => run.runId))
    for (const [runId, subscription] of subscriptions.current) {
      if (eligibleRunIds.has(runId)) continue
      subscriptions.current.delete(runId)
      subscription.unsubscribe()
      updateConnection(runId, undefined)
    }
    for (const run of eligibleRuns) {
      if (subscriptions.current.has(run.runId)) continue
      const subscription = adminApi.subscribeApprovals(
        { runId: run.runId, cursor: run.cursor },
        {
          onConnection: (state) => {
            if (subscriptions.current.has(run.runId)) updateConnection(run.runId, state)
          },
          onEvent: () => {
            if (subscriptions.current.has(run.runId)) refreshRef.current()
          },
          onError: () => {
            if (subscriptions.current.has(run.runId)) {
              setError("Approval updates are disconnected.")
            }
          },
        },
      )
      subscriptions.current.set(run.runId, subscription)
      updateConnection(run.runId, "connecting")
    }
  }, [updateConnection])

  const refresh = useCallback(() => {
    void Promise.all([load(), reconcileSubscriptions()]).catch(() =>
      setError("Pending approvals are unavailable."),
    )
  }, [load, reconcileSubscriptions])

  useEffect(() => {
    mounted.current = true
    refreshRef.current = refresh
    refresh()
    return () => {
      mounted.current = false
      refreshVersion.current += 1
      for (const subscription of subscriptions.current.values()) subscription.unsubscribe()
      subscriptions.current.clear()
      connectionByRun.current.clear()
    }
  }, [refresh])

  const upsert = useCallback((next: Approval) => {
    setApprovals((current) => {
      const index = current.findIndex((approval) => approval.approvalId === next.approvalId)
      if (index === -1) return [...current, next]
      return current.map((approval) => (approval.approvalId === next.approvalId ? next : approval))
    })
  }, [])

  const approve = useCallback(
    async (approval: Approval): Promise<boolean> => {
      refreshVersion.current += 1
      decidingIdRef.current = approval.approvalId
      setDecidingId(approval.approvalId)
      setError(undefined)
      try {
        const decided = await adminApi.approve({
          decision: "approve",
          approvalId: approval.approvalId,
          callId: approval.callId,
          expectedArgumentsHash: approval.argumentsHash,
          expectedVersion: approval.version,
        })
        upsert(decided)
        return true
      } catch {
        setError("Approval changed before this decision. Reload the exact snapshot.")
        return false
      } finally {
        decidingIdRef.current = undefined
        setDecidingId(undefined)
      }
    },
    [upsert],
  )

  const reject = useCallback(
    async (approval: Approval, reason: string): Promise<boolean> => {
      refreshVersion.current += 1
      decidingIdRef.current = approval.approvalId
      setDecidingId(approval.approvalId)
      setError(undefined)
      try {
        const decided = await adminApi.reject({
          decision: "reject",
          approvalId: approval.approvalId,
          callId: approval.callId,
          expectedArgumentsHash: approval.argumentsHash,
          expectedVersion: approval.version,
          reason,
        })
        upsert(decided)
        return true
      } catch {
        setError("Approval changed before this decision. Reload the exact snapshot.")
        return false
      } finally {
        decidingIdRef.current = undefined
        setDecidingId(undefined)
      }
    },
    [upsert],
  )

  return { approvals, connection, error, decidingId, approve, reject }
}
