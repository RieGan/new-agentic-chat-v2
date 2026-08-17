import type { ReactNode } from "react"

type AppShellProps = {
  readonly activePath: string
  readonly viewer: "user" | "admin" | "none"
  readonly children: ReactNode
}

const USER_NAV = [{ href: "/user/chat", label: "User chat" }] as const
const ADMIN_NAV = [
  { href: "/admin", label: "Run inspector" },
  { href: "/admin/approvals", label: "Approvals" },
] as const

export const AppShell = ({ activePath, viewer, children }: AppShellProps) => (
  <div className="app-shell">
    <a className="skip-link" href="#main-content">
      Skip to main content
    </a>
    <header className="topbar">
      <a className="brand" href="/user/chat" aria-label="Agentic Chat operations console">
        <span className="brand-mark" aria-hidden="true" />
        <span>
          <strong>Agentic Chat</strong>
          <small>Architecture console</small>
        </span>
      </a>
      <nav aria-label="Primary navigation" className="nav-cluster">
        {(viewer === "user" ? USER_NAV : viewer === "admin" ? ADMIN_NAV : []).map((item) => (
          <a
            className="nav-link"
            href={item.href}
            aria-current={activePath === item.href ? "page" : undefined}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </header>
    <main id="main-content" className="route-main" tabIndex={-1}>
      {children}
    </main>
  </div>
)

type PanelProps = {
  readonly title?: string
  readonly subtitle?: string
  readonly tone?: "default" | "quiet" | "selected"
  readonly children: ReactNode
  readonly testId?: string
}

export const Panel = ({ title, subtitle, tone = "default", children, testId }: PanelProps) => (
  <section className={`panel panel--${tone}`} data-testid={testId}>
    {title === undefined ? null : (
      <header className="panel-header">
        <h2>{title}</h2>
        {subtitle === undefined ? null : <p>{subtitle}</p>}
      </header>
    )}
    {children}
  </section>
)

type StatusTone = "neutral" | "active" | "success" | "warning" | "danger"

export const StatusLabel = ({
  label,
  tone = "neutral",
  testId,
}: {
  readonly label: string
  readonly tone?: StatusTone
  readonly testId?: string
}) => (
  <span className={`status status--${tone}`} data-testid={testId}>
    {label}
  </span>
)

export const EmptyState = ({ children }: { readonly children: ReactNode }) => (
  <p className="empty-state">{children}</p>
)

export const Meta = ({ label, value }: { readonly label: string; readonly value: ReactNode }) => (
  <div className="meta-row">
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
)
