-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserArtifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"browser_run_id" uuid NOT NULL,
	"email" text NOT NULL,
	"agentId" varchar,
	"browser_session_id" uuid,
	"source" varchar(20) NOT NULL,
	"filename" varchar(400),
	"mime_type" varchar(120),
	"size_bytes" integer,
	"checksum" varchar(100),
	"storage_key" varchar(500),
	"verification_state" varchar(20) DEFAULT 'pending' NOT NULL,
	"retention_state" varchar(20) DEFAULT 'retained' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"browser_run_id" uuid NOT NULL,
	"email" text NOT NULL,
	"browser_session_id" uuid,
	"sequence" integer NOT NULL,
	"kind" varchar(40) NOT NULL,
	"actor" varchar(20) NOT NULL,
	"actor_id" varchar(200),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_artifact_run" ON "browserArtifact" USING btree ("browser_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_event_run_sequence" ON "browserEvent" USING btree ("browser_run_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "browser_event_owner" ON "browserEvent" USING btree ("email","created_at");