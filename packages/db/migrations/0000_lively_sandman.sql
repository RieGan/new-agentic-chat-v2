CREATE TYPE "public"."admin_command_status" AS ENUM('accepted', 'applied', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('pending', 'dispatched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_actor" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'waiting_for_tool', 'waiting_for_admin', 'waiting_for_user', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."runtime" AS ENUM('simple_loop', 'state_workflow');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('prepared', 'running', 'approval_required', 'waiting_job', 'completed', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tool_mode" AS ENUM('sync', 'async');--> statement-breakpoint
CREATE TYPE "public"."tool_risk" AS ENUM('read', 'low', 'high');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('user', 'admin', 'model_only', 'internal');--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"approval_id" text NOT NULL,
	"call_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_actions_approval_unique" UNIQUE("approval_id"),
	CONSTRAINT "approval_actions_call_unique" UNIQUE("call_id"),
	CONSTRAINT "approval_actions_admin_only" CHECK ("approval_actions"."actor_id" = 'mvp_admin'),
	CONSTRAINT "approval_actions_rejection_reason" CHECK (("approval_actions"."decision" = 'approved' and "approval_actions"."reason" is null) or ("approval_actions"."decision" = 'rejected' and length("approval_actions"."reason") > 0))
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"call_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"arguments_hash" text NOT NULL,
	"required_actor_id" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_call_id_unique" UNIQUE("call_id"),
	CONSTRAINT "approval_requests_version_nonnegative" CHECK ("approval_requests"."version" >= 0),
	CONSTRAINT "approval_requests_arguments_hash_not_empty" CHECK (length("approval_requests"."arguments_hash") > 0),
	CONSTRAINT "approval_requests_email_only" CHECK ("approval_requests"."tool_id" = 'notification.send_email' and "approval_requests"."required_actor_id" = 'mvp_admin')
);
--> statement-breakpoint
CREATE TABLE "admin_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"instruction" text NOT NULL,
	"visibility" "visibility" DEFAULT 'model_only' NOT NULL,
	"status" "admin_command_status" DEFAULT 'accepted' NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_commands_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "admin_commands_hidden_admin_only" CHECK ("admin_commands"."actor_id" = 'mvp_admin' and "admin_commands"."visibility" = 'model_only'),
	CONSTRAINT "admin_commands_instruction_not_empty" CHECK (length("admin_commands"."instruction") > 0),
	CONSTRAINT "admin_commands_version_nonnegative" CHECK ("admin_commands"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dispatch_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"deduplication_key" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "dispatch_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_intents_deduplication_key_unique" UNIQUE("deduplication_key"),
	CONSTRAINT "dispatch_intents_attempts_nonnegative" CHECK ("dispatch_intents"."attempts" >= 0),
	CONSTRAINT "dispatch_intents_topic_not_empty" CHECK (length("dispatch_intents"."topic") > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_not_empty" CHECK (length("idempotency_keys"."scope") > 0),
	CONSTRAINT "idempotency_keys_request_hash_not_empty" CHECK (length("idempotency_keys"."request_hash") > 0)
);
--> statement-breakpoint
CREATE TABLE "simulated_sends" (
	"call_id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulated_sends_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"visibility" "visibility" NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_sequence_unique" UNIQUE("run_id","sequence"),
	CONSTRAINT "run_events_sequence_positive" CHECK ("run_events"."sequence" > 0),
	CONSTRAINT "run_events_type_not_empty" CHECK (length("run_events"."type") > 0)
);
--> statement-breakpoint
CREATE TABLE "run_skill_snapshots" (
	"run_id" text PRIMARY KEY NOT NULL,
	"skill_id" text NOT NULL,
	"skill_version" text NOT NULL,
	"instructions" text NOT NULL,
	"allowed_tools" text[] NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_skill_snapshot_identity_unique" UNIQUE("run_id","skill_id","skill_version"),
	CONSTRAINT "run_skill_snapshots_instructions_not_empty" CHECK (length("run_skill_snapshots"."instructions") > 0),
	CONSTRAINT "run_skill_snapshots_allowed_tools_not_empty" CHECK (cardinality("run_skill_snapshots"."allowed_tools") > 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"runtime" "runtime" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"consumed_steps" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"fencing_version" integer DEFAULT 0 NOT NULL,
	"workflow_identity" text,
	"continuation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_workflow_identity_unique" UNIQUE("workflow_identity"),
	CONSTRAINT "runs_version_nonnegative" CHECK ("runs"."version" >= 0),
	CONSTRAINT "runs_consumed_steps_nonnegative" CHECK ("runs"."consumed_steps" >= 0),
	CONSTRAINT "runs_fencing_version_nonnegative" CHECK ("runs"."fencing_version" >= 0),
	CONSTRAINT "runs_lease_complete" CHECK (("runs"."lease_owner" is null and "runs"."lease_expires_at" is null) or ("runs"."lease_owner" is not null and "runs"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" "role_name" PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" "role_name" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_events_job_sequence_unique" UNIQUE("job_id","sequence"),
	CONSTRAINT "job_events_sequence_positive" CHECK ("job_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"call_id" text NOT NULL,
	"workflow_identity" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"percent" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_call_id_unique" UNIQUE("call_id"),
	CONSTRAINT "jobs_workflow_identity_unique" UNIQUE("workflow_identity"),
	CONSTRAINT "jobs_percent_range" CHECK ("jobs"."percent" between 0 and 100),
	CONSTRAINT "jobs_version_nonnegative" CHECK ("jobs"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"run_id" text,
	"actor" "message_actor" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"skill_id" text NOT NULL,
	"version" text NOT NULL,
	"instructions" text NOT NULL,
	"allowed_tools" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_skill_id_version_pk" PRIMARY KEY("skill_id","version"),
	CONSTRAINT "skill_versions_instructions_not_empty" CHECK (length("skill_versions"."instructions") > 0),
	CONSTRAINT "skill_versions_allowed_tools_not_empty" CHECK (cardinality("skill_versions"."allowed_tools") > 0)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_versions" (
	"tool_id" text NOT NULL,
	"version" text NOT NULL,
	"mode" "tool_mode" NOT NULL,
	"risk" "tool_risk" NOT NULL,
	"approval_required" boolean NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_versions_tool_id_version_pk" PRIMARY KEY("tool_id","version")
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tool_id" text NOT NULL,
	"tool_version" text NOT NULL,
	"status" "tool_call_status" DEFAULT 'prepared' NOT NULL,
	"arguments" jsonb NOT NULL,
	"arguments_hash" text NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_calls_version_nonnegative" CHECK ("tool_calls"."version" >= 0),
	CONSTRAINT "tool_calls_arguments_hash_not_empty" CHECK (length("tool_calls"."arguments_hash") > 0)
);
--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_approval_id_approval_requests_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_call_id_tool_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_call_id_tool_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_required_actor_id_users_id_fk" FOREIGN KEY ("required_actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_commands" ADD CONSTRAINT "admin_commands_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_commands" ADD CONSTRAINT "admin_commands_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulated_sends" ADD CONSTRAINT "simulated_sends_call_id_tool_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."tool_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skill_snapshots" ADD CONSTRAINT "run_skill_snapshots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skill_snapshots" ADD CONSTRAINT "run_skill_snapshots_skill_version_fk" FOREIGN KEY ("skill_id","skill_version") REFERENCES "public"."skill_versions"("skill_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_call_id_tool_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_versions" ADD CONSTRAINT "tool_versions_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_tool_version_fk" FOREIGN KEY ("tool_id","tool_version") REFERENCES "public"."tool_versions"("tool_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_run_id_idx" ON "approval_requests" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "admin_commands_run_status_idx" ON "admin_commands" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "dispatch_intents_pending_idx" ON "dispatch_intents" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "conversations_user_id_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "run_events_run_occurred_idx" ON "run_events" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "runs_runtime_status_updated_idx" ON "runs" USING btree ("runtime","status","updated_at");--> statement-breakpoint
CREATE INDEX "runs_conversation_id_idx" ON "runs" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "users_role_id_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "job_events_job_occurred_idx" ON "job_events" USING btree ("job_id","occurred_at");--> statement-breakpoint
CREATE INDEX "jobs_run_status_idx" ON "jobs" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE INDEX "tool_calls_run_status_idx" ON "tool_calls" USING btree ("run_id","status");