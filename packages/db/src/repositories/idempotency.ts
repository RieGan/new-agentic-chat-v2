import { ConflictError } from "@agentic-chat/contracts"
import { eq } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { idempotencyKeys } from "../schema/index.js"
import type { IdempotencyInput, IdempotencyResult } from "./types.js"

export const reserveIdempotency = async (
  database: DatabaseClient,
  input: IdempotencyInput,
): Promise<IdempotencyResult> =>
  database.db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(idempotencyKeys)
      .values({
        key: input.key,
        scope: input.scope,
        requestHash: input.requestHash,
        response: input.response,
      })
      .onConflictDoNothing()
      .returning({ response: idempotencyKeys.response })
    const stored = inserted[0]
    if (stored) {
      return { kind: "stored", response: stored.response }
    }
    const existing = await transaction
      .select({
        scope: idempotencyKeys.scope,
        requestHash: idempotencyKeys.requestHash,
        response: idempotencyKeys.response,
      })
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, input.key))
      .limit(1)
    const replay = existing[0]
    if (!replay || replay.scope !== input.scope || replay.requestHash !== input.requestHash) {
      throw new ConflictError(`idempotency key ${input.key}`)
    }
    return { kind: "replayed", response: replay.response }
  })
