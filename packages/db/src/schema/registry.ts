import type { AiToolName } from "@agentic-chat/contracts"
import { sql } from "drizzle-orm"
import { boolean, check, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

import { type JsonValue, toolModeEnum, toolRiskEnum } from "./common.js"

export const skills = pgTable("skills", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const skillVersions = pgTable(
  "skill_versions",
  {
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    instructions: text("instructions").notNull(),
    allowedTools: text("allowed_tools").array().$type<readonly AiToolName[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.skillId, table.version] }),
    check("skill_versions_instructions_not_empty", sql`length(${table.instructions}) > 0`),
    check("skill_versions_allowed_tools_not_empty", sql`cardinality(${table.allowedTools}) > 0`),
  ],
)

export const tools = pgTable("tools", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const toolVersions = pgTable(
  "tool_versions",
  {
    toolId: text("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    mode: toolModeEnum("mode").notNull(),
    risk: toolRiskEnum("risk").notNull(),
    approvalRequired: boolean("approval_required").notNull(),
    inputSchema: jsonb("input_schema").$type<JsonValue>().notNull(),
    outputSchema: jsonb("output_schema").$type<JsonValue>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.toolId, table.version] })],
)
