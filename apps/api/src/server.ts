import { createServer, type Server } from "node:http"

import { FIXED_ACTORS } from "@agentic-chat/contracts"
import { createHTTPHandler } from "@trpc/server/adapters/standalone"

import { createApiContext } from "./context.js"
import type { RunEventSource } from "./events/source.js"
import { appRouter } from "./router.js"
import type { ApiServices } from "./services.js"

export type ApiServerOptions = {
  readonly services: ApiServices
  readonly events: RunEventSource
  readonly readiness: () => Promise<boolean>
}

const READY_RESPONSE = JSON.stringify({
  service: "api",
  status: "ready",
  dependencies: { database: "ready" },
})
const NOT_READY_RESPONSE = JSON.stringify({
  service: "api",
  status: "not_ready",
  dependencies: { database: "unavailable" },
})

export const createApiHttpServer = (options: ApiServerOptions): Server => {
  const userHandler = createHTTPHandler({
    router: appRouter,
    basePath: "/trpc/user/",
    createContext: () => createApiContext(FIXED_ACTORS.USER, options.services, options.events),
  })
  const adminHandler = createHTTPHandler({
    router: appRouter,
    basePath: "/trpc/admin/",
    createContext: () => createApiContext(FIXED_ACTORS.ADMIN, options.services, options.events),
  })
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") {
      void options.readiness().then((ready) => {
        response.statusCode = ready ? 200 : 503
        response.setHeader("content-type", "application/json")
        response.end(ready ? READY_RESPONSE : NOT_READY_RESPONSE)
      })
      return
    }
    if (request.url?.startsWith("/trpc/user/")) {
      void userHandler(request, response)
      return
    }
    if (request.url?.startsWith("/trpc/admin/")) {
      void adminHandler(request, response)
      return
    }
    response.statusCode = 404
    response.end("Not Found")
  })
}
