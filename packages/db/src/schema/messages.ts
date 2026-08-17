import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { messageActorEnum } from "./common.js"
import { conversations } from "./conversations.js"
import { runs } from "./executions.js"

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    actor: messageActorEnum("actor").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt, table.id),
  ],
)
