import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"

import {
  adminCommandStatusEnum,
  dispatchStatusEnum,
  type JsonValue,
  visibilityEnum,
} from "./common.js"
import { runs } from "./executions.js"
import { users } from "./identities.js"
import { toolCalls } from "./tool-calls.js"

export const adminCommands = pgTable(
  "admin_commands",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    instruction: text("instruction").notNull(),
    visibility: visibilityEnum("visibility").notNull().default("model_only"),
    status: adminCommandStatusEnum("status").notNull().default("accepted"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    version: integer("version").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_commands_run_status_idx").on(table.runId, table.status),
    check(
      "admin_commands_hidden_admin_only",
      sql`${table.actorId} = 'mvp_admin' and ${table.visibility} = 'model_only'`,
    ),
    check("admin_commands_instruction_not_empty", sql`length(${table.instruction}) > 0`),
    check("admin_commands_version_nonnegative", sql`${table.version} >= 0`),
  ],
)

export const dispatchIntents = pgTable(
  "dispatch_intents",
  {
    id: text("id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    deduplicationKey: text("deduplication_key").notNull().unique(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    status: dispatchStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dispatch_intents_pending_idx").on(table.status, table.availableAt, table.createdAt),
    check("dispatch_intents_attempts_nonnegative", sql`${table.attempts} >= 0`),
    check("dispatch_intents_topic_not_empty", sql`length(${table.topic}) > 0`),
  ],
)

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<JsonValue>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("idempotency_keys_scope_not_empty", sql`length(${table.scope}) > 0`),
    check("idempotency_keys_request_hash_not_empty", sql`length(${table.requestHash}) > 0`),
  ],
)

export const simulatedSends = pgTable(
  "simulated_sends",
  {
    callId: text("call_id")
      .primaryKey()
      .references(() => toolCalls.id, { onDelete: "restrict" }),
    messageId: text("message_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("simulated_sends_message_id_unique").on(table.messageId)],
)
