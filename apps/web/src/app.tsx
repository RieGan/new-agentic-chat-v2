import { AdminRoute } from "./routes/admin.js"
import { AdminApprovalsRoute } from "./routes/admin-approvals.js"
import { NotFoundRoute } from "./routes/not-found.js"
import { UserChatRoute } from "./routes/user-chat.js"

const TITLES = {
  "/user/chat": "Durable chat | Agentic Chat",
  "/admin": "Run inspector | Agentic Chat",
  "/admin/approvals": "Exact approvals | Agentic Chat",
} as const

export const App = () => {
  const path = window.location.pathname
  switch (path) {
    case "/user/chat":
      document.title = TITLES[path]
      return <UserChatRoute />
    case "/admin":
      document.title = TITLES[path]
      return <AdminRoute />
    case "/admin/approvals":
      document.title = TITLES[path]
      return <AdminApprovalsRoute />
    default:
      document.title = "Route not found | Agentic Chat"
      return <NotFoundRoute path={path} />
  }
}
