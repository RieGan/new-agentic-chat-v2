import type { SyntheticEvent } from "react"
import { useEffect, useRef, useState } from "react"

import { ConversationControls } from "../components/conversation-controls.js"
import { ConnectionStatus, EventLedger, MessageLog } from "../components/run-events.js"
import { AppShell, Meta, Panel, StatusLabel } from "../components/ui.js"
import { useUserChat } from "../state/use-user-chat.js"

const runTone = (status: string | undefined) => {
  if (status === "completed") return "success" as const
  if (status === "failed") return "danger" as const
  if (status?.startsWith("waiting") === true) return "warning" as const
  return "active" as const
}

export const UserChatRoute = () => {
  const chat = useUserChat()
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const restoreFocus = useRef(false)
  const [message, setMessage] = useState("")
  const [validation, setValidation] = useState<string>()

  useEffect(() => {
    if (chat.busy || !restoreFocus.current) return
    restoreFocus.current = false
    composerRef.current?.focus()
  }, [chat.busy])

  const submit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    const content = message.trim()
    if (content.length === 0) {
      setValidation("Enter a message before sending.")
      composerRef.current?.focus()
      return
    }
    setValidation(undefined)
    restoreFocus.current = true
    const sent = await chat.send(content)
    if (sent) setMessage("")
  }

  const run = chat.projection?.run
  return (
    <AppShell activePath="/user/chat" viewer="user">
      <div data-testid="user-chat-route">
        <header className="route-header">
          <div>
            <h1>Durable chat</h1>
            <p>
              Completed messages only. Tool and job status update independently from the final
              answer.
            </p>
          </div>
          <div className="status-cluster" aria-live="polite" aria-atomic="true">
            <ConnectionStatus connection={chat.connection} />
            <StatusLabel
              label={run?.status.replaceAll("_", " ") ?? "no run"}
              tone={runTone(run?.status)}
              testId="run-status"
            />
          </div>
        </header>

        <ConversationControls
          conversations={chat.conversations}
          selectedConversationId={chat.selectedConversationId}
          busy={chat.sessionsBusy}
          onSelect={chat.selectConversation}
          onCreate={chat.createConversation}
        />

        <div className="workspace-grid">
          <div className="stack">
            <Panel
              title="Completed messages"
              subtitle="Assistant text enters this log only after message.completed is persisted."
            >
              <MessageLog messages={chat.conversation?.messages ?? []} />
            </Panel>

            <Panel title="Compose" subtitle="Enter submits. Shift+Enter adds a new line.">
              <form className="form-stack" onSubmit={submit} data-testid="message-form">
                <div className="field">
                  <label htmlFor="runtime">Runtime</label>
                  <select
                    id="runtime"
                    className="select"
                    data-testid="runtime-selector"
                    value={chat.runtime}
                    onChange={(event) =>
                      chat.setRuntime(
                        event.currentTarget.value === "state_workflow"
                          ? "state_workflow"
                          : "simple_loop",
                      )
                    }
                    disabled={chat.busy || chat.selectedConversationId === undefined}
                  >
                    <option value="simple_loop">Simple Loop</option>
                    <option value="state_workflow">State Workflow</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="message">Message</label>
                  <textarea
                    ref={composerRef}
                    id="message"
                    className="textarea"
                    data-testid="message-composer"
                    value={message}
                    onChange={(event) => setMessage(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                    aria-describedby="message-help message-error"
                    aria-invalid={validation !== undefined}
                    disabled={chat.busy || chat.selectedConversationId === undefined}
                  />
                  <small id="message-help">
                    Messages are admitted to the selected runtime as one command.
                  </small>
                  <span id="message-error" role="alert" className="field-help">
                    {validation}
                  </span>
                </div>
                <div className="action-cluster">
                  <button
                    className="button button--primary"
                    data-testid="send-message"
                    type="submit"
                    disabled={chat.busy || chat.selectedConversationId === undefined}
                  >
                    {chat.busy ? "Sending..." : "Send message"}
                  </button>
                </div>
              </form>
            </Panel>
          </div>

          <aside className="stack" aria-label="Run status and canonical events">
            <Panel title="Run projection" tone={run === undefined ? "quiet" : "selected"}>
              <div className="panel-body">
                <p className="inline-notice" aria-live="polite" data-testid="recovery-status">
                  {chat.notice}
                </p>
                {chat.error === undefined ? null : (
                  <p role="alert" className="inline-notice">
                    {chat.error}
                  </p>
                )}
                {run === undefined ? null : (
                  <dl className="meta-list">
                    <Meta label="Run" value={<span className="mono">{run.runId}</span>} />
                    <Meta label="Runtime" value={run.runtime.replaceAll("_", " ")} />
                    <Meta label="Steps" value={`${run.consumedSteps} / 8`} />
                    <Meta label="Version" value={run.version} />
                    <Meta label="Cursor" value={run.cursor.sequence} />
                  </dl>
                )}
              </div>
            </Panel>
            <Panel title="Status ledger" subtitle="Discrete persisted events, never token deltas.">
              <EventLedger frames={chat.events} />
            </Panel>
          </aside>
        </div>
      </div>
    </AppShell>
  )
}
