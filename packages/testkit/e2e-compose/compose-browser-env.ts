import { z } from "zod"

const environmentSchema = z.object({
  COMPOSE_BROWSER_RUNTIME: z.enum(["simple_loop", "state_workflow"]),
  COMPOSE_BROWSER_NAMESPACE: z.string().regex(/^[a-z0-9_-]+$/),
})

const environment = environmentSchema.parse(process.env)

export const composeRuntime = environment.COMPOSE_BROWSER_RUNTIME
export const composeNamespace = environment.COMPOSE_BROWSER_NAMESPACE
export const runtimeLabel = composeRuntime === "simple_loop" ? "simple loop" : "state workflow"
export const targetWorker = composeRuntime === "simple_loop" ? "worker-simple" : "worker-workflow"
