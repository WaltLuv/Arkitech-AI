-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserSitePolicy" (
	"agent_id" varchar PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"allow_public" boolean DEFAULT true NOT NULL,
	"allowed_hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
