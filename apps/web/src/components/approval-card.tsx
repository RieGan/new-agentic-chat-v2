import type { ApprovalEnvelope } from "@agentic-chat/contracts"
import type { SyntheticEvent } from "react"
import { useRef, useState } from "react"

import { Meta, StatusLabel } from "./ui.js"

type ApprovalCardProps = {
  readonly approval: ApprovalEnvelope
  readonly busy: boolean
  readonly onApprove: (approval: ApprovalEnvelope) => Promise<boolean>
  readonly onReject: (approval: ApprovalEnvelope, reason: string) => Promise<boolean>
}

const approvalTone = (status: ApprovalEnvelope["status"]) => {
  switch (status) {
    case "pending":
      return "warning" as const
    case "approved":
      return "success" as const
    case "rejected":
    case "expired":
      return "danger" as const
  }
}

export const ApprovalCard = ({ approval, busy, onApprove, onReject }: ApprovalCardProps) => {
  const cardRef = useRef<HTMLElement>(null)
  const approveRef = useRef<HTMLButtonElement>(null)
  const rejectRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const [reason, setReason] = useState("")
  const [validation, setValidation] = useState<string>()

  const approve = async () => {
    const decided = await onApprove(approval)
    if (decided) cardRef.current?.focus()
    else approveRef.current?.focus()
  }

  const reject = async (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault()
    const rejectedBecause = reason.trim()
    if (rejectedBecause.length === 0) {
      setValidation("Give a reason before rejecting this exact action.")
      reasonRef.current?.focus()
      return
    }
    setValidation(undefined)
    const decided = await onReject(approval, rejectedBecause)
    if (decided) cardRef.current?.focus()
    else rejectRef.current?.focus()
  }

  return (
    <article
      ref={cardRef}
      className="panel approval-card"
      data-status={approval.status}
      data-testid={`approval-card-${approval.approvalId}`}
      tabIndex={-1}
    >
      <header className="panel-header">
        <div className="approval-card-header">
          <div>
            <h2>{approval.toolName}</h2>
            <p className="mono">{approval.approvalId}</p>
          </div>
          <StatusLabel
            label={approval.status}
            tone={approvalTone(approval.status)}
            testId={`approval-status-${approval.approvalId}`}
          />
        </div>
      </header>
      <div className="approval-body stack">
        <dl className="approval-details">
          <Meta label="Run" value={<span className="mono">{approval.runId}</span>} />
          <Meta label="Call" value={<span className="mono">{approval.callId}</span>} />
          <Meta
            label="Preview"
            value={<span className="mono">{approval.arguments.previewId}</span>}
          />
          <Meta
            label="Arguments hash"
            value={<span className="mono">{approval.argumentsHash}</span>}
          />
          <Meta label="Version" value={approval.version} />
          <Meta label="Required actor" value={approval.requiredActor} />
          <Meta
            label="Expires"
            value={<time dateTime={approval.expiresAt}>{approval.expiresAt}</time>}
          />
        </dl>

        {approval.status !== "pending" ? (
          <p className="inline-notice" aria-live="polite">
            Decision recorded as {approval.status}. The prepared snapshot remains mounted for
            review.
          </p>
        ) : (
          <div className="approval-actions">
            <button
              ref={approveRef}
              className="button button--primary"
              type="button"
              data-testid={`approve-${approval.approvalId}`}
              onClick={approve}
              disabled={busy}
            >
              {busy ? "Recording..." : "Approve exact action"}
            </button>
            <form className="field" onSubmit={reject}>
              <label htmlFor={`reason-${approval.approvalId}`}>Rejection reason</label>
              <input
                ref={reasonRef}
                id={`reason-${approval.approvalId}`}
                className="input"
                data-testid={`reject-reason-${approval.approvalId}`}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                aria-describedby={`reason-error-${approval.approvalId}`}
                aria-invalid={validation !== undefined}
                disabled={busy}
              />
              <span id={`reason-error-${approval.approvalId}`} className="field-help" role="alert">
                {validation}
              </span>
              <button
                ref={rejectRef}
                className="button button--danger"
                type="submit"
                data-testid={`reject-${approval.approvalId}`}
                disabled={busy}
              >
                Reject exact action
              </button>
            </form>
          </div>
        )}
      </div>
    </article>
  )
}
