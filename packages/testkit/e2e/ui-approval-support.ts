import type { Page } from "@playwright/test"
import { createTRPCClient, httpLink } from "@trpc/client"

import type { AppRouter } from "../../../apps/api/src/router.js"

const adminClient = createTRPCClient<AppRouter>({
  links: [httpLink({ url: "http://127.0.0.1:4311/trpc/admin" })],
})

export const clearPendingApprovals = async (): Promise<void> => {
  const pending = await adminClient.approvals.listPending.query({})
  await Promise.all(
    pending.map((approval) =>
      adminClient.approvals.approve.mutate({
        decision: "approve",
        approvalId: approval.approvalId,
        callId: approval.callId,
        expectedArgumentsHash: approval.argumentsHash,
        expectedVersion: approval.version,
      }),
    ),
  )
}

export const createPendingApproval = async (): Promise<void> => {
  await adminClient.admin.command.sendHidden.mutate({
    conversationId: "conversation_race_fast",
    instruction: "CREATE_APPROVAL_FIXTURE_EVENT",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    idempotencyKey: crypto.randomUUID(),
  })
}

type EventSourceCounts = {
  readonly opened: number
  readonly closed: number
}

const EVENT_SOURCE_COUNTS_KEY = "approval-event-source-counts"

export const observeApprovalEventSource = async (page: Page): Promise<void> => {
  await page.addInitScript((storageKey) => {
    const browser = globalThis as typeof globalThis & {
      EventSource: typeof EventSource
      sessionStorage: {
        getItem(key: string): string | null
        setItem(key: string, value: string): void
      }
    }
    const NativeEventSource = browser.EventSource
    const readCounts = (): EventSourceCounts => {
      const stored = browser.sessionStorage.getItem(storageKey)
      return stored === null ? { opened: 0, closed: 0 } : JSON.parse(stored)
    }
    const record = (kind: keyof EventSourceCounts) => {
      const counts = readCounts()
      browser.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          ...counts,
          [kind]: counts[kind] + 1,
        }),
      )
    }
    const ObservedEventSource = new Proxy(NativeEventSource, {
      construct(nativeConstructor, argumentsList) {
        const [url, eventSourceInitDict] = argumentsList as ConstructorParameters<
          typeof EventSource
        >
        const source = new nativeConstructor(url, eventSourceInitDict)
        const decodedUrl = decodeURIComponent(url.toString())
        const targetUrl =
          decodedUrl.includes("approvals.subscribe") && decodedUrl.includes("run_race_fast")
        if (!targetUrl) return source
        record("opened")
        const close = source.close.bind(source)
        source.close = () => {
          record("closed")
          close()
        }
        return source
      },
    })
    browser.EventSource = ObservedEventSource
  }, EVENT_SOURCE_COUNTS_KEY)
}

export const approvalEventSourceCounts = async (page: Page): Promise<EventSourceCounts> =>
  page.evaluate((storageKey) => {
    const browser = globalThis as typeof globalThis & {
      sessionStorage: { getItem(key: string): string | null }
    }
    const stored = browser.sessionStorage.getItem(storageKey)
    return stored === null ? { opened: 0, closed: 0 } : JSON.parse(stored)
  }, EVENT_SOURCE_COUNTS_KEY)
