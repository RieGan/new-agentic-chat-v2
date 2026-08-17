import { parseContract, RunIdSchema } from "@agentic-chat/contracts"
import { z } from "zod"

import type { SimpleLoopResult } from "./runtime.js"

const workerInputSchema = z
  .object({
    owner: z.string().trim().min(1),
    durationSeconds: z.number().int().positive().max(3600),
  })
  .strict()

export interface SimpleLoopExecutor {
  execute(input: unknown): Promise<SimpleLoopResult>
}

export const createSimpleLoopWorker = (runtime: SimpleLoopExecutor, input: unknown) => {
  const configuration = workerInputSchema.parse(input)
  let claims = 0
  return {
    execute: async (runIdInput: unknown): Promise<SimpleLoopResult> => {
      const runId = parseContract(RunIdSchema, runIdInput)
      const result = await runtime.execute({ runId, ...configuration })
      claims += 1
      return result
    },
    inspect: () => ({ runtime: "simple_loop" as const, claims }),
  }
}
