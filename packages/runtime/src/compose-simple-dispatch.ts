import { ConflictError, RunIdSchema } from "@agentic-chat/contracts"
import {
  acknowledgeSimpleLoopDispatch,
  acknowledgeStaleSimpleLoopDispatch,
  type DatabaseClient,
} from "@agentic-chat/db"
import { z } from "zod"

const intentSchema = z.looseObject({
  intentId: z.string().trim().min(1),
  topic: z.literal("simple_loop.execute"),
  payload: z.looseObject({ runId: RunIdSchema }),
})

type DurableExecutionResult = {
  readonly status:
    | "waiting_for_tool"
    | "waiting_for_admin"
    | "waiting_for_user"
    | "completed"
    | "failed"
}

type HandleSimpleLoopDispatchInput<Result extends DurableExecutionResult> = {
  readonly database: DatabaseClient
  readonly executor: { execute(input: unknown): Promise<Result> }
  readonly intent: unknown
  readonly handledAt: Date
}

type HandleSimpleLoopDispatchResult<Result extends DurableExecutionResult> =
  | { readonly kind: "handled"; readonly result: Result }
  | { readonly kind: "already_handled" }

export const handleSimpleLoopDispatch = async <Result extends DurableExecutionResult>(
  input: HandleSimpleLoopDispatchInput<Result>,
): Promise<HandleSimpleLoopDispatchResult<Result>> => {
  const intent = intentSchema.parse(input.intent)
  let result: Result
  try {
    result = await input.executor.execute(intent.payload.runId)
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error
    const acknowledged = await acknowledgeStaleSimpleLoopDispatch(input.database, {
      intentId: intent.intentId,
      runId: intent.payload.runId,
      dispatchedAt: input.handledAt,
    })
    if (!acknowledged) throw error
    return { kind: "already_handled" }
  }
  await acknowledgeSimpleLoopDispatch(input.database, {
    intentId: intent.intentId,
    runId: intent.payload.runId,
    dispatchedAt: input.handledAt,
  })
  return { kind: "handled", result }
}
