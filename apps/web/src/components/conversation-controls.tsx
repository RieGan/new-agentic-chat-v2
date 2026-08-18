import { type ConversationId, ConversationIdSchema } from "@agentic-chat/contracts"

import type { ConversationSummary } from "../state/use-conversation-sessions.js"
import { Panel } from "./ui.js"

type ConversationControlsProps = {
  readonly conversations: readonly ConversationSummary[]
  readonly selectedConversationId: ConversationId | undefined
  readonly busy: boolean
  readonly onSelect: (conversationId: ConversationId) => void
  readonly onCreate: () => Promise<boolean>
}

export const ConversationControls = ({
  conversations,
  selectedConversationId,
  busy,
  onSelect,
  onCreate,
}: ConversationControlsProps) => (
  <div className="session-panel">
    <Panel title="Sessions" subtitle="Messages and run state stay isolated per durable session.">
      <div className="conversation-controls">
        <div className="field">
          <label htmlFor="conversation">Session</label>
          <select
            id="conversation"
            className="select mono"
            data-testid="conversation-selector"
            value={selectedConversationId ?? ""}
            onChange={(event) => onSelect(ConversationIdSchema.parse(event.currentTarget.value))}
            disabled={busy || conversations.length === 0}
          >
            {conversations.map((conversation, index) => (
              <option key={conversation.conversationId} value={conversation.conversationId}>
                Session {conversations.length - index} - {conversation.conversationId.slice(-8)}
              </option>
            ))}
          </select>
        </div>
        <div className="action-cluster">
          <button
            className="button"
            data-testid="create-conversation"
            type="button"
            onClick={() => void onCreate()}
            disabled={busy}
          >
            {busy ? "Loading sessions..." : "New session"}
          </button>
        </div>
      </div>
    </Panel>
  </div>
)
