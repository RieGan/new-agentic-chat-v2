import { ApprovalCard } from "../components/approval-card.js"
import { connectionTone } from "../components/run-events.js"
import { AppShell, EmptyState, StatusLabel } from "../components/ui.js"
import { useApprovals } from "../state/use-approvals.js"

export const AdminApprovalsRoute = () => {
  const state = useApprovals()
  return (
    <AppShell activePath="/admin/approvals" viewer="admin">
      <div data-testid="admin-approvals-route">
        <header className="route-header">
          <div>
            <h1>Exact approvals</h1>
            <p>
              Decisions bind the prepared call, arguments hash, and aggregate version shown here.
            </p>
          </div>
          <StatusLabel
            label={`Updates ${state.connection}`}
            tone={connectionTone(state.connection)}
            testId="approvals-connection-status"
          />
        </header>

        {state.error === undefined ? null : (
          <p className="inline-notice" role="alert">
            {state.error}
          </p>
        )}
        {state.approvals.length === 0 ? (
          <div className="panel">
            <EmptyState>
              No pending approvals. New exact snapshots appear without a page refresh.
            </EmptyState>
          </div>
        ) : (
          <div className="approval-grid" data-testid="approval-grid">
            {state.approvals.map((approval) => (
              <ApprovalCard
                key={approval.approvalId}
                approval={approval}
                busy={state.decidingId === approval.approvalId}
                onApprove={state.approve}
                onReject={state.reject}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
