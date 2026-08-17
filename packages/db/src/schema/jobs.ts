import { sql } from "drizzle-orm"
import { check, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"

import { type JsonValue, jobStatusEnum } from "./common.js"
import { runs } from "./executions.js"
import { toolCalls } from "./tool-calls.js"

export const jobs = pgTable(
  "jobs",
  {
    ledgerKey: text("ledger_key").primaryKey(),
    namespace: text("namespace").notNull(),
    id: text("id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    callId: text("call_id")
      .notNull()
      .unique()
      .references(() => toolCalls.id, { onDelete: "cascade" }),
    bullmqJobId: text("bullmq_job_id").notNull().unique(),
    workflowIdentity: text("workflow_identity").notNull().unique(),
    status: jobStatusEnum("status").notNull().default("queued"),
    percent: integer("percent").notNull().default(0),
    result: jsonb("result").$type<JsonValue>(),
    error: jsonb("error").$type<JsonValue>(),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_run_status_idx").on(table.runId, table.status),
    unique("jobs_namespace_run_id_unique").on(table.namespace, table.runId, table.id),
    check("jobs_namespace_not_empty", sql`length(${table.namespace}) > 0`),
    check("jobs_percent_range", sql`${table.percent} between 0 and 100`),
    check("jobs_version_nonnegative", sql`${table.version} >= 0`),
  ],
)

export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    jobKey: text("job_key")
      .notNull()
      .references(() => jobs.ledgerKey, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("job_events_job_sequence_unique").on(table.jobKey, table.sequence),
    index("job_events_job_occurred_idx").on(table.jobKey, table.occurredAt),
    check("job_events_sequence_positive", sql`${table.sequence} > 0`),
  ],
)
