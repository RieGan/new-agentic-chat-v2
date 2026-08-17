import { adminRouter } from "./routers/admin.js"
import { approvalsRouter } from "./routers/approvals.js"
import { jobsRouter, skillsRouter } from "./routers/catalog.js"
import { chatRouter } from "./routers/chat.js"
import { conversationsRouter } from "./routers/conversations.js"
import { runsRouter } from "./routers/runs.js"
import { router } from "./trpc.js"

export const appRouter = router({
  conversations: conversationsRouter,
  chat: chatRouter,
  runs: runsRouter,
  admin: adminRouter,
  approvals: approvalsRouter,
  jobs: jobsRouter,
  skills: skillsRouter,
})

export type AppRouter = typeof appRouter
