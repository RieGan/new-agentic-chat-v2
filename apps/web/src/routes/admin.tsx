import type { SyntheticEvent } from "react"
import { useEffect, useRef, useState } from "react"

import { ConnectionStatus, EventLedger } from "../components/run-events.js"
import { AppShell, EmptyState, Meta, Panel, StatusLabel } from "../components/ui.js"
import { useAdminRuns } from "../state/use-admin-runs.js"

export const AdminRoute = () => {
  const admin = useAdminRuns()
  const commandRef = useRef<HTMLTextAreaElement>(null)
  const restoreFocus = useRef(false)
  const [instruction, setInstruction] = useState("")
  const [validation, setValidation] = useState<string>()

  useEffect(() => {
    if (admin.sending || !restoreFocus.current) return
    restoreFocus.current = false
    commandRef.current?.focus()
  }, [admin.sending])

  const submit = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    const command = instruction.trim()
    if (command.length === 0) {
      setValidation("Enter guidance for the selected session.")
      commandRef.current?.focus()
      return
    }
    setValidation(undefined)
    restoreFocus.current = true
    const accepted = await admin.sendHidden(command)
    if (accepted) setInstruction("")
  }

  const run = admin.projection?.run
  return (
    <AppShell activePath="/admin" viewer="admin">
      <div data-testid="admin-route">
        <header className="route-header">
          <div>
            <h1>Run inspector</h1>
            <p>Inspect canonical events and queue guidance for the next safe model boundary.</p>
          </div>
          <div className="status-cluster" aria-live="polite">
            <ConnectionStatus connection={admin.connection} />
            <StatusLabel label={run?.status.replaceAll("_", " ") ?? "select a run"} />
          </div>
        </header>

        <div className="inspector-grid">
          <Panel title="Runs" subtitle={`${admin.runs.length} persisted projections`}>
            {admin.runs.length === 0 ? (
              <EmptyState>No runs are available.</EmptyState>
            ) : (
              <ul className="run-list" data-testid="admin-run-list">
                {admin.runs.map((item) => (
                  <li key={item.runId}>
                    <button
                      className="run-button"
                      type="button"
                      aria-pressed={admin.selectedRunId === item.runId}
                      data-testid={`select-run-${item.runId}`}
                      onClick={() => admin.selectRun(item.runId)}
                    >
                      <span className="mono">{item.runId}</span>
                      <small>
                        {item.runtime.replaceAll("_", " ")} / {item.status.replaceAll("_", " ")}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="stack">
            <Panel title="Canonical projection" tone={run === undefined ? "quiet" : "selected"}>
              <div className="panel-body">
                <p className="inline-notice" aria-live="polite" data-testid="admin-notice">
                  {admin.notice}
                </p>
                {admin.error === undefined ? null : (
                  <p className="inline-notice" role="alert">
                    {admin.error}
                  </p>
                )}
                {run === undefined ? null : (
                  <dl className="meta-list" data-testid="admin-run-projection">
                    <Meta label="Run" value={<span className="mono">{run.runId}</span>} />
                    <Meta
                      label="Conversation"
                      value={<span className="mono">{run.conversationId}</span>}
                    />
                    <Meta label="Runtime" value={run.runtime.replaceAll("_", " ")} />
                    <Meta label="Status" value={run.status.replaceAll("_", " ")} />
                    <Meta label="Version" value={run.version} />
                    <Meta label="Cursor" value={run.cursor.sequence} />
                  </dl>
                )}
              </div>
            </Panel>

            <Panel
              title="Hidden session command"
              subtitle="Visible only in Admin. Queued for this session and applied once at the next safe model boundary."
            >
              <form className="form-stack" onSubmit={submit}>
                <div className="field">
                  <label htmlFor="hidden-command-session">Session</label>
                  <select
                    id="hidden-command-session"
                    className="select"
                    data-testid="admin-conversation-selector"
                    value={admin.selectedConversationId ?? ""}
                    onChange={(event) => admin.selectConversation(event.currentTarget.value)}
                    disabled={admin.conversations.length === 0}
                  >
                    {admin.conversations.map((conversation, index) => (
                      <option key={conversation.conversationId} value={conversation.conversationId}>
                        Session {admin.conversations.length - index} · {conversation.conversationId}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="hidden-command">Instruction</label>
                  <textarea
                    ref={commandRef}
                    id="hidden-command"
                    className="textarea"
                    data-testid="hidden-command-input"
                    value={instruction}
                    onChange={(event) => setInstruction(event.currentTarget.value)}
                    aria-describedby="hidden-help hidden-error"
                    aria-invalid={validation !== undefined}
                    disabled={admin.selectedConversationId === undefined || admin.sending}
                  />
                  <small id="hidden-help">
                    The command targets this session directly and expires after five minutes.
                  </small>
                  <span id="hidden-error" className="field-help" role="alert">
                    {validation}
                  </span>
                </div>
                <div className="action-cluster">
                  <button
                    className="button button--primary"
                    type="submit"
                    data-testid="send-hidden-command"
                    disabled={admin.selectedConversationId === undefined || admin.sending}
                  >
                    {admin.sending ? "Queueing..." : "Queue session command"}
                  </button>
                </div>
              </form>
            </Panel>

            <Panel
              title="Admin event ledger"
              subtitle="Includes Admin and model-only lifecycle events."
            >
              <EventLedger frames={admin.events} testId="admin-event-ledger" />
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
