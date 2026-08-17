import { FIXED_ACTORS } from "@agentic-chat/contracts"
import { initTRPC, TRPCError } from "@trpc/server"
import type { ApiContext } from "./context.js"
import { CursorInvalidatedError } from "./events/cursor.js"

const t = initTRPC.context<ApiContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(error.cause instanceof CursorInvalidatedError ? { refetch: error.cause.refetch } : {}),
      },
    }
  },
  sse: { ping: { enabled: true, intervalMs: 10_000 } },
})

const forbidden = (): TRPCError => new TRPCError({ code: "FORBIDDEN" })

export const mvpViewerProcedure = t.procedure.use(({ ctx, next }) => {
  switch (ctx.actor.role) {
    case "user":
      if (ctx.actor.id !== FIXED_ACTORS.USER.id) throw forbidden()
      return next({ ctx: { ...ctx, actor: FIXED_ACTORS.USER } })
    case "admin":
      if (ctx.actor.id !== FIXED_ACTORS.ADMIN.id) throw forbidden()
      return next({ ctx: { ...ctx, actor: FIXED_ACTORS.ADMIN } })
    default: {
      const exhaustiveRole: never = ctx.actor
      return exhaustiveRole
    }
  }
})

export const mvpUserProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor.id !== FIXED_ACTORS.USER.id || ctx.actor.role !== FIXED_ACTORS.USER.role) {
    throw forbidden()
  }
  return next({ ctx: { ...ctx, actor: FIXED_ACTORS.USER } })
})

export const mvpAdminProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.actor.id !== FIXED_ACTORS.ADMIN.id || ctx.actor.role !== FIXED_ACTORS.ADMIN.role) {
    throw forbidden()
  }
  return next({ ctx: { ...ctx, actor: FIXED_ACTORS.ADMIN } })
})

export const router = t.router
