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
  unique,
} from "drizzle-orm/pg-core"

import { approvalDecisionEnum, approvalStatusEnum, type JsonValue } from "./common.js"
import { runs } from "./executions.js"
import { users } from "./identities.js"
import { toolVersions } from "./registry.js"
import { toolCalls } from "./tool-calls.js"

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    callId: text("call_id")
      .notNull()
      .unique()
      .references(() => toolCalls.id, { onDelete: "cascade" }),
    toolId: text("tool_id").notNull(),
    toolVersion: text("tool_version").notNull(),
    arguments: jsonb("arguments").$type<JsonValue>().notNull(),
    argumentsHash: text("arguments_hash").notNull(),
    requiredActorId: text("required_actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: approvalStatusEnum("status").notNull().default("pending"),
    version: integer("version").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.toolId, table.toolVersion],
      foreignColumns: [toolVersions.toolId, toolVersions.version],
      name: "approval_requests_tool_version_fk",
    }).onDelete("restrict"),
    index("approval_requests_status_created_idx").on(table.status, table.createdAt),
    index("approval_requests_run_id_idx").on(table.runId),
    check("approval_requests_version_nonnegative", sql`${table.version} >= 0`),
    check("approval_requests_arguments_hash_not_empty", sql`length(${table.argumentsHash}) > 0`),
    check(
      "approval_requests_email_only",
      sql`${table.toolId} = 'notification.send_email' and ${table.requiredActorId} = 'mvp_admin'`,
    ),
  ],
)

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: text("id").primaryKey(),
    approvalId: text("approval_id")
      .notNull()
      .references(() => approvalRequests.id, { onDelete: "cascade" }),
    callId: text("call_id")
      .notNull()
      .references(() => toolCalls.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decision: approvalDecisionEnum("decision").notNull(),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("approval_actions_approval_unique").on(table.approvalId),
    unique("approval_actions_call_unique").on(table.callId),
    check("approval_actions_admin_only", sql`${table.actorId} = 'mvp_admin'`),
    check(
      "approval_actions_rejection_reason",
      sql`(${table.decision} = 'approved' and ${table.reason} is null) or (${table.decision} = 'rejected' and length(${table.reason}) > 0)`,
    ),
  ],
)
