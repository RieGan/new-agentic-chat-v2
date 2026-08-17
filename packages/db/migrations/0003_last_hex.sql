ALTER TABLE "job_events" RENAME COLUMN "job_id" TO "job_key";--> statement-breakpoint
ALTER TABLE "job_events" DROP CONSTRAINT "job_events_job_sequence_unique";--> statement-breakpoint
ALTER TABLE "job_events" DROP CONSTRAINT "job_events_job_id_jobs_id_fk";
--> statement-breakpoint
DROP INDEX "job_events_job_occurred_idx";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_pkey";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "ledger_key" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "namespace" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "bullmq_job_id" text;--> statement-breakpoint
UPDATE "jobs" SET "ledger_key" = "id", "namespace" = 'legacy', "bullmq_job_id" = 'legacy-' || "id";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "ledger_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "namespace" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "bullmq_job_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("ledger_key");--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_key_jobs_ledger_key_fk" FOREIGN KEY ("job_key") REFERENCES "public"."jobs"("ledger_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_events_job_occurred_idx" ON "job_events" USING btree ("job_key","occurred_at");--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_sequence_unique" UNIQUE("job_key","sequence");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_bullmq_job_id_unique" UNIQUE("bullmq_job_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_namespace_run_id_unique" UNIQUE("namespace","run_id","id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_namespace_not_empty" CHECK (length("jobs"."namespace") > 0);
