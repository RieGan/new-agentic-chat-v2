import type { AiToolName, CanonicalEvent } from "@agentic-chat/contracts"
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

import { type JsonValue, runStatusEnum, runtimeEnum, visibilityEnum } from "./common.js"
import { conversations } from "./conversations.js"
import { users } from "./identities.js"
import { skillVersions } from "./registry.js"

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    runtime: runtimeEnum("runtime").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    version: integer("version").notNull().default(0),
    consumedSteps: integer("consumed_steps").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fencingVersion: integer("fencing_version").notNull().default(0),
    workflowIdentity: text("workflow_identity").unique(),
    continuation: jsonb("continuation").$type<JsonValue>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runs_runtime_status_updated_idx").on(table.runtime, table.status, table.updatedAt),
    index("runs_conversation_id_idx").on(table.conversationId, table.createdAt),
    unique("runs_conversation_id_id_unique").on(table.conversationId, table.id),
    check("runs_version_nonnegative", sql`${table.version} >= 0`),
    check("runs_consumed_steps_nonnegative", sql`${table.consumedSteps} >= 0`),
    check("runs_fencing_version_nonnegative", sql`${table.fencingVersion} >= 0`),
    check(
      "runs_lease_complete",
      sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null) or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
)

export const runSkillSnapshots = pgTable(
  "run_skill_snapshots",
  {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    skillVersion: text("skill_version").notNull(),
    instructions: text("instructions").notNull(),
    allowedTools: text("allowed_tools").array().$type<readonly AiToolName[]>().notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.skillId, table.skillVersion],
      foreignColumns: [skillVersions.skillId, skillVersions.version],
      name: "run_skill_snapshots_skill_version_fk",
    }).onDelete("restrict"),
    unique("run_skill_snapshot_identity_unique").on(table.runId, table.skillId, table.skillVersion),
    check("run_skill_snapshots_instructions_not_empty", sql`length(${table.instructions}) > 0`),
    check(
      "run_skill_snapshots_allowed_tools_not_empty",
      sql`cardinality(${table.allowedTools}) > 0`,
    ),
  ],
)

export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    visibility: visibilityEnum("visibility").notNull(),
    payload: jsonb("payload").$type<CanonicalEvent["payload"]>().notNull(),
    correlationId: text("correlation_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("run_events_run_sequence_unique").on(table.runId, table.sequence),
    index("run_events_run_occurred_idx").on(table.runId, table.occurredAt),
    check("run_events_sequence_positive", sql`${table.sequence} > 0`),
    check("run_events_type_not_empty", sql`length(${table.type}) > 0`),
  ],
)
