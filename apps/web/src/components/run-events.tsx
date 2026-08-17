import type { CanonicalEvent } from "@agentic-chat/contracts"

import type { ConnectionState, StreamFrame } from "../api/client.js"
import { EmptyState, StatusLabel } from "./ui.js"

type CompletedMessage = {
  readonly messageId: string
  readonly actor: "user" | "ai"
  readonly content: string
}

const eventSummary = (event: CanonicalEvent): string => {
  switch (event.type) {
    case "run.status_changed":
      return `${event.payload.previous.replaceAll("_", " ")} to ${event.payload.current.replaceAll("_", " ")}`
    case "skill.loaded":
      return `${event.payload.skillId}@${event.payload.version}, ${event.payload.allowedTools.length} tools allowed`
    case "tool.call.started":
      return `${event.payload.toolName} started`
    case "tool.call.approval_required":
      return `${event.payload.toolName} is waiting for review`
    case "tool.call.waiting_job":
      return `${event.payload.toolName} is waiting for a durable job`
    case "tool.call.completed":
      return `${event.payload.toolName} completed`
    case "tool.call.failed":
      return `${event.payload.toolName} failed safely`
    case "tool.call.rejected":
      return `${event.payload.toolName} was rejected`
    case "approval.requested":
      return `${event.payload.toolName} requires an exact decision`
    case "approval.approved":
      return "Exact prepared action approved"
    case "approval.rejected":
      return "Exact prepared action rejected"
    case "approval.expired":
      return "Prepared action expired"
    case "job.accepted":
      return `Job ${event.payload.jobId} queued`
    case "job.progress":
      return `Job ${event.payload.jobId} is ${event.payload.percent}% complete`
    case "job.completed":
      return `Job ${event.payload.jobId} completed`
    case "job.failed":
      return `Job ${event.payload.jobId} failed safely`
    case "admin.command.accepted":
      return "Hidden command accepted"
    case "admin.command.applied":
      return "Hidden command applied at the model boundary"
    case "admin.command.rejected":
      return "Hidden command rejected"
    case "admin.command.expired":
      return "Hidden command expired"
    case "message.completed":
      return `${event.payload.actor === "ai" ? "Assistant" : "User"} message persisted atomically`
    default: {
      const exhaustiveEvent: never = event
      return exhaustiveEvent
    }
  }
}

export const connectionTone = (connection: ConnectionState): "active" | "success" | "warning" => {
  switch (connection) {
    case "connected":
      return "success"
    case "connecting":
      return "active"
    case "disconnected":
      return "warning"
    default: {
      const exhaustiveConnection: never = connection
      return exhaustiveConnection
    }
  }
}

export const EventLedger = ({
  frames,
  testId = "event-ledger",
}: {
  readonly frames: readonly StreamFrame[]
  readonly testId?: string
}) => {
  if (frames.length === 0) return <EmptyState>No canonical events yet.</EmptyState>
  return (
    <ol className="event-ledger" data-testid={testId} aria-label="Canonical run events">
      {frames.map(({ id, event }) => (
        <li key={id}>
          <div className="event-row">
            <span>
              <strong>{event.type}</strong>
              <small>{eventSummary(event)}</small>
            </span>
            <span className="sequence">#{event.sequence}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

export const MessageLog = ({ messages }: { readonly messages: readonly CompletedMessage[] }) => (
  <div
    className="message-log"
    data-testid="message-log"
    role="log"
    aria-live="polite"
    aria-relevant="additions text"
    aria-label="Completed messages"
  >
    {messages.length === 0 ? (
      <EmptyState>Completed messages appear here after durable persistence.</EmptyState>
    ) : (
      messages.map((message) => (
        <article
          className={`message message--${message.actor}`}
          data-testid={`message-${message.actor}`}
          key={message.messageId}
        >
          <h3>{message.actor === "ai" ? "Assistant" : "You"}</h3>
          <p>{message.content}</p>
        </article>
      ))
    )}
  </div>
)

export const ConnectionStatus = ({ connection }: { readonly connection: ConnectionState }) => (
  <StatusLabel
    label={`Live ${connection}`}
    tone={connectionTone(connection)}
    testId="connection-status"
  />
)
