import { ConflictError } from "@agentic-chat/contracts"
import { and, desc, eq } from "drizzle-orm"

import type { DatabaseClient } from "../database.js"
import { conversations } from "../schema/index.js"

export type StoredConversation = typeof conversations.$inferSelect

type CreateConversationInput = {
  readonly conversationId: string
  readonly userId: string
  readonly now: Date
}

export const createConversation = async (
  database: DatabaseClient,
  input: CreateConversationInput,
): Promise<StoredConversation> =>
  database.db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(conversations)
      .values({
        id: input.conversationId,
        userId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: conversations.id })
      .returning()
    if (inserted[0]) return inserted[0]

    const existing = await transaction
      .select()
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1)
    if (existing[0]?.userId !== input.userId) {
      throw new ConflictError(`conversation ${input.conversationId}`)
    }
    return existing[0]
  })

export const listConversations = async (
  database: DatabaseClient,
  input: { readonly userId: string },
): Promise<readonly StoredConversation[]> =>
  database.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, input.userId)))
    .orderBy(desc(conversations.updatedAt), desc(conversations.id))
