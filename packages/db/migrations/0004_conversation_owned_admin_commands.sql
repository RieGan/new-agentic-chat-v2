ALTER TABLE "admin_commands" DROP CONSTRAINT "admin_commands_run_id_runs_id_fk";
--> statement-breakpoint
DROP INDEX "admin_commands_run_status_idx";--> statement-breakpoint
DROP INDEX "conversations_user_id_idx";--> statement-breakpoint
ALTER TABLE "admin_commands" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "admin_commands" ADD COLUMN "applied_run_id" text;--> statement-breakpoint
ALTER TABLE "admin_commands" ADD COLUMN "boundary_key" text;--> statement-breakpoint
UPDATE "admin_commands" AS command
SET
  "conversation_id" = run."conversation_id",
  "status" = CASE WHEN command."status" = 'accepted' THEN 'expired' ELSE command."status" END,
  "applied_run_id" = CASE WHEN command."status" = 'applied' THEN command."run_id" ELSE NULL END,
  "boundary_key" = CASE WHEN command."status" = 'applied' THEN 'legacy:' || command."id" ELSE NULL END,
  "applied_at" = CASE
    WHEN command."status" = 'applied' THEN COALESCE(command."applied_at", command."created_at")
    ELSE NULL
  END
FROM "runs" AS run
WHERE run."id" = command."run_id";--> statement-breakpoint
ALTER TABLE "admin_commands" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_commands" ADD CONSTRAINT "admin_commands_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_conversation_id_id_unique" UNIQUE("conversation_id","id");--> statement-breakpoint
ALTER TABLE "admin_commands" ADD CONSTRAINT "admin_commands_conversation_applied_run_fk" FOREIGN KEY ("conversation_id","applied_run_id") REFERENCES "public"."runs"("conversation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_commands_conversation_status_idx" ON "admin_commands" USING btree ("conversation_id","status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_commands_conversation_boundary_unique" ON "admin_commands" USING btree ("conversation_id","boundary_key") WHERE "admin_commands"."boundary_key" is not null;--> statement-breakpoint
CREATE INDEX "conversations_user_id_idx" ON "conversations" USING btree ("user_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "admin_commands" DROP COLUMN "run_id";--> statement-breakpoint
ALTER TABLE "admin_commands" ADD CONSTRAINT "admin_commands_application_consistent" CHECK ((
        "admin_commands"."status" = 'applied'
        and "admin_commands"."applied_run_id" is not null
        and "admin_commands"."boundary_key" is not null
        and "admin_commands"."applied_at" is not null
      ) or (
        "admin_commands"."status" <> 'applied'
        and "admin_commands"."applied_run_id" is null
        and "admin_commands"."boundary_key" is null
        and "admin_commands"."applied_at" is null
      ));
