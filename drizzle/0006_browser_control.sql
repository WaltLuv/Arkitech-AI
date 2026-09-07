-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserControlLease" (
	"browser_run_id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"holder_kind" varchar(10) NOT NULL,
	"holder_id" varchar(200),
	"generation" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
