import { createDatabase } from "@agentic-chat/db"
import { secureIds, systemClock } from "@agentic-chat/runtime"
import { createToolRegistry } from "@agentic-chat/tools"
import { z } from "zod"

import { startApiApplication } from "./application.js"
import { createPollingRunEventSource } from "./events/source.js"

const environmentSchema = z.looseObject({ DATABASE_URL: z.url() })
const environment = environmentSchema.parse(process.env)
const database = createDatabase(environment.DATABASE_URL)
const application = await startApiApplication({
  dependencies: {
    database,
    clock: systemClock,
    ids: secureIds,
    tools: createToolRegistry(),
  },
  events: createPollingRunEventSource(),
  listen: { host: "0.0.0.0", port: 3000 },
})

const shutdown = (): void => {
  void application.shutdown().catch((error: unknown) => {
    if (!(error instanceof Error)) throw error
    process.stderr.write(`API shutdown failed: ${error.message}\n`)
    process.exitCode = 1
  })
}

process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
