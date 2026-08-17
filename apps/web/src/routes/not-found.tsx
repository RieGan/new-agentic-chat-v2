import { AppShell, Panel } from "../components/ui.js"

export const NotFoundRoute = ({ path }: { readonly path: string }) => (
  <AppShell activePath="" viewer="none">
    <header className="route-header">
      <div>
        <h1>Route not found</h1>
        <p className="mono">{path}</p>
      </div>
    </header>
    <Panel title="Choose a console surface">
      <div className="panel-body action-cluster">
        <a className="button button--primary" href="/user/chat">
          Open User chat
        </a>
        <a className="button" href="/admin">
          Open run inspector
        </a>
        <a className="button" href="/admin/approvals">
          Open approvals
        </a>
      </div>
    </Panel>
  </AppShell>
)
