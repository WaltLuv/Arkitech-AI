-- Idempotent, matching the convention of the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"agentId" varchar NOT NULL,
	"runId" uuid,
	"task" text NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"priority" varchar(10) DEFAULT 'normal' NOT NULL,
	"cancel_requested_at" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_by" varchar(100),
	"failure_reason" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserSession" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"browser_run_id" uuid NOT NULL,
	"email" text NOT NULL,
	"creation_key" varchar(100) NOT NULL,
	"browserbase_session_id" varchar(120),
	"browserbase_context_id" varchar(120),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"release_state" varchar(20) DEFAULT 'not_requested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agentConfig" ADD COLUMN IF NOT EXISTS "slot_index" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_run_queue" ON "browserRun" USING btree ("status","priority","queued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_run_owner" ON "browserRun" USING btree ("email","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_session_creation_key" ON "browserSession" USING btree ("creation_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_session_run" ON "browserSession" USING btree ("browser_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_config_user_slot" ON "agentConfig" USING btree ("email","slot_index");