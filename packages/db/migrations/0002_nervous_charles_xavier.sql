ALTER TABLE "approval_requests" ADD COLUMN "tool_version" text;--> statement-breakpoint
UPDATE "approval_requests" AS approval
SET "tool_version" = call."tool_version"
FROM "tool_calls" AS call
WHERE call."id" = approval."call_id";--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "tool_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tool_version_fk" FOREIGN KEY ("tool_id","tool_version") REFERENCES "public"."tool_versions"("tool_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION prevent_approval_binding_update() RETURNS trigger AS $$
BEGIN
  IF ROW(NEW.id, NEW.run_id, NEW.call_id, NEW.tool_id, NEW.tool_version, NEW.arguments, NEW.arguments_hash, NEW.required_actor_id, NEW.expires_at)
    IS DISTINCT FROM
    ROW(OLD.id, OLD.run_id, OLD.call_id, OLD.tool_id, OLD.tool_version, OLD.arguments, OLD.arguments_hash, OLD.required_actor_id, OLD.expires_at) THEN
    RAISE EXCEPTION 'approval binding is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER approval_requests_immutable_binding
BEFORE UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION prevent_approval_binding_update();
