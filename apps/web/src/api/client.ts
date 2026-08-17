import {
  AdminCommandEnvelopeSchema,
  AdminCommandInputSchema,
  AdminProjectionSchema,
  ApprovalApproveInputSchema,
  ApprovalEnvelopeSchema,
  ApprovalListPendingInputSchema,
  ApprovalRejectInputSchema,
  type CanonicalEvent,
  CanonicalEventSchema,
  ChatSendMessageInputSchema,
  CommandAcceptedOutputSchema,
  ConversationGetInputSchema,
  ConversationProjectionSchema,
  RunGetInputSchema,
  RunSubscriptionInputSchema,
  RunsListInputSchema,
  RunsListOutputSchema,
  UserProjectionSchema,
} from "@agentic-chat/contracts"
import { createTRPCClient, httpLink, httpSubscriptionLink, splitLink } from "@trpc/client"

import type { AppRouter } from "../../../api/src/router.js"

const createClient = (viewer: "user" | "admin") =>
  createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: httpSubscriptionLink({ url: `/trpc/${viewer}` }),
        false: httpLink({ url: `/trpc/${viewer}` }),
      }),
    ],
  })

const userClient = createClient("user")
const adminClient = createClient("admin")

export type ConnectionState = "connecting" | "connected" | "disconnected"

type Unsubscribable = { readonly unsubscribe: () => void }

export type StreamFrame = {
  readonly id: string
  readonly event: CanonicalEvent
}

export type StreamObserver = {
  readonly onConnection: (state: ConnectionState) => void
  readonly onEvent: (frame: StreamFrame) => void
  readonly onError: (error: unknown) => void
}

const parseTrackedFrame = (value: unknown, allowHidden: boolean): StreamFrame | undefined => {
  if (value === null || typeof value !== "object" || !("id" in value) || !("data" in value)) {
    return undefined
  }
  const id = Reflect.get(value, "id")
  const parsed = CanonicalEventSchema.safeParse(Reflect.get(value, "data"))
  if (typeof id !== "string" || !parsed.success) return undefined
  if (!allowHidden && parsed.data.visibility !== "user") return undefined
  return { id, event: parsed.data }
}

const streamObserver = (observer: StreamObserver, allowHidden: boolean) => ({
  onStarted: () => observer.onConnection("connected"),
  onConnectionStateChange: (state: { readonly state: "idle" | "connecting" | "pending" }) => {
    switch (state.state) {
      case "pending":
        observer.onConnection("connected")
        break
      case "connecting":
        observer.onConnection("connecting")
        break
      case "idle":
        observer.onConnection("disconnected")
        break
    }
  },
  onData: (value: unknown) => {
    const frame = parseTrackedFrame(value, allowHidden)
    if (frame !== undefined) observer.onEvent(frame)
  },
  onError: observer.onError,
  onStopped: () => observer.onConnection("disconnected"),
})

export const userApi = {
  async sendMessage(input: unknown) {
    const parsed = ChatSendMessageInputSchema.parse(input)
    return CommandAcceptedOutputSchema.parse(await userClient.chat.sendMessage.mutate(parsed))
  },
  async conversation(input: unknown) {
    const parsed = ConversationGetInputSchema.parse(input)
    return ConversationProjectionSchema.parse(await userClient.conversations.get.query(parsed))
  },
  async run(input: unknown) {
    const parsed = RunGetInputSchema.parse(input)
    return UserProjectionSchema.parse(await userClient.runs.get.query(parsed))
  },
  subscribe(input: unknown, observer: StreamObserver): Unsubscribable {
    const parsed = RunSubscriptionInputSchema.parse(input)
    return userClient.runs.events.subscribe(parsed, streamObserver(observer, false))
  },
}

export const adminApi = {
  async runs(input: unknown) {
    const parsed = RunsListInputSchema.parse(input)
    return RunsListOutputSchema.parse(await adminClient.runs.list.query(parsed))
  },
  async run(input: unknown) {
    const parsed = RunGetInputSchema.parse(input)
    return AdminProjectionSchema.parse(await adminClient.runs.get.query(parsed))
  },
  async sendHidden(input: unknown) {
    const parsed = AdminCommandInputSchema.parse(input)
    return AdminCommandEnvelopeSchema.parse(
      await adminClient.admin.command.sendHidden.mutate(parsed),
    )
  },
  async approvals(input: unknown) {
    const parsed = ApprovalListPendingInputSchema.parse(input)
    const output = await adminClient.approvals.listPending.query(parsed)
    return ApprovalEnvelopeSchema.array().parse(output)
  },
  async approve(input: unknown) {
    const parsed = ApprovalApproveInputSchema.parse(input)
    return ApprovalEnvelopeSchema.parse(await adminClient.approvals.approve.mutate(parsed))
  },
  async reject(input: unknown) {
    const parsed = ApprovalRejectInputSchema.parse(input)
    return ApprovalEnvelopeSchema.parse(await adminClient.approvals.reject.mutate(parsed))
  },
  subscribeRun(input: unknown, observer: StreamObserver): Unsubscribable {
    const parsed = RunSubscriptionInputSchema.parse(input)
    return adminClient.runs.events.subscribe(parsed, streamObserver(observer, true))
  },
  subscribeApprovals(input: unknown, observer: StreamObserver): Unsubscribable {
    const parsed = RunSubscriptionInputSchema.parse(input)
    return adminClient.approvals.subscribe.subscribe(parsed, streamObserver(observer, true))
  },
}

export const requestsCanonicalRefetch = (error: unknown): boolean => {
  if (error === null || typeof error !== "object" || !("data" in error)) return false
  const data = Reflect.get(error, "data")
  return (
    data !== null &&
    typeof data === "object" &&
    Reflect.get(data, "refetch") === "canonical_snapshot"
  )
}
