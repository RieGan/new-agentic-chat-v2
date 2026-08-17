import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { roleNameEnum } from "./common.js"

export const roles = pgTable("roles", {
  id: roleNameEnum("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    roleId: roleNameEnum("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_role_id_idx").on(table.roleId)],
)
