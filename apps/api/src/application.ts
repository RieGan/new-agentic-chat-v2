import type { Server } from "node:http"

import type { DatabaseClient } from "@agentic-chat/db"

import type { RunEventSource } from "./events/source.js"
import { createApiHttpServer } from "./server.js"
import { createApiServices, type ApiServiceDependencies } from "./services.js"

type ApiApplicationOptions = {
  readonly dependencies: ApiServiceDependencies
  readonly events: RunEventSource
  readonly listen: {
    readonly host: string
    readonly port: number
  }
}

export type ApiApplication = {
  readonly server: Server
  readonly shutdown: () => Promise<void>
}

export const createDatabaseReadiness =
  (database: DatabaseClient): (() => Promise<boolean>) => async () => {
    try {
      await database.pool.query("select 1")
      return true
    } catch (error) {
      if (error instanceof Error) return false
      throw error
    }
  }

export const startApiApplication = async (
  options: ApiApplicationOptions,
): Promise<ApiApplication> => {
  const server = createApiHttpServer({
    services: createApiServices(options.dependencies),
    events: options.events,
    readiness: createDatabaseReadiness(options.dependencies.database),
  })
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(options.listen.port, options.listen.host, () => {
      server.off("error", onError)
      resolve()
    })
  })

  let shutdownPromise: Promise<void> | undefined
  return {
    server,
    shutdown: () => {
      shutdownPromise ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
        server.closeAllConnections()
      }).then(() => options.dependencies.database.close())
      return shutdownPromise
    },
  }
}
