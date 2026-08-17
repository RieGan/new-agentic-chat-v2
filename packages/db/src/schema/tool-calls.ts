import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { type JsonValue, toolCallStatusEnum } from "./common.js"
import { runs } from "./executions.js"
import { toolVersions } from "./registry.js"

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    toolVersion: text("tool_version").notNull(),
    status: toolCallStatusEnum("status").notNull().default("prepared"),
    arguments: jsonb("arguments").$type<JsonValue>().notNull(),
    argumentsHash: text("arguments_hash").notNull(),
    result: jsonb("result").$type<JsonValue>(),
    error: jsonb("error").$type<JsonValue>(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.toolId, table.toolVersion],
      foreignColumns: [toolVersions.toolId, toolVersions.version],
      name: "tool_calls_tool_version_fk",
    }).onDelete("restrict"),
    index("tool_calls_run_status_idx").on(table.runId, table.status),
    check("tool_calls_version_nonnegative", sql`${table.version} >= 0`),
    check("tool_calls_arguments_hash_not_empty", sql`length(${table.argumentsHash}) > 0`),
  ],
)
