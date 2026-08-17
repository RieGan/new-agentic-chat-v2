import { createServer as createViteServer } from "vite"
import { createPollingRunEventSource } from "../../../apps/api/src/events/source.js"
import { createApiHttpServer } from "../../../apps/api/src/server.js"
import { createUiFixtureServices } from "./ui-fixture-services.js"

const API_PORT = 4311
const WEB_PORT = 4310
const api = createApiHttpServer({
  services: createUiFixtureServices(),
  events: createPollingRunEventSource(15),
  readiness: async () => true,
})
await new Promise<void>((resolve) => api.listen(API_PORT, "127.0.0.1", resolve))
const vite = await createViteServer({
  root: "apps/web",
  server: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: { "/trpc": `http://127.0.0.1:${API_PORT}` },
  },
})
await vite.listen()

const close = async () => {
  await vite.close()
  await new Promise<void>((resolve) => api.close(() => resolve()))
}
process.on("SIGINT", () => void close().then(() => process.exit(0)))
process.on("SIGTERM", () => void close().then(() => process.exit(0)))
