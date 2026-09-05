-- Idempotent by design. This repository had no migration history, so an
-- existing database was created with `drizzle-kit push` and already holds
-- users, tools, agentConfig and agentRun. Every statement below is written to
-- succeed whether the object exists or not, so this file is safe on both an
-- existing database and a fresh one.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agentConfig" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"agentId" varchar NOT NULL,
	"name" varchar,
	"agentImage" varchar,
	"description" text,
	"instructions" text,
	"objective" text,
	"tools" jsonb,
	"skills" jsonb,
	"schedule" jsonb,
	"outputFormat" text,
	"status" varchar DEFAULT 'active',
	"composioSessionId" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agentConfig_agentId_unique" UNIQUE("agentId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agentRun" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agentId" varchar NOT NULL,
	"email" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"timezone" varchar(100) NOT NULL,
	"status" varchar DEFAULT 'scheduled' NOT NULL,
	"output" jsonb,
	"error" text,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creditLedger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"agentId" varchar,
	"runId" uuid,
	"amount" integer NOT NULL,
	"direction" varchar(10) NOT NULL,
	"reason" varchar(40) NOT NULL,
	"balance_after" integer NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"category" varchar(100) NOT NULL,
	"type" varchar(50) NOT NULL,
	"provider" varchar(100) NOT NULL,
	"icon" text,
	"status" varchar(50) DEFAULT 'active',
	"requires_auth" boolean DEFAULT false,
	"auth_type" varchar(50),
	"auth_provider" varchar(100),
	"capabilities" jsonb DEFAULT '[]'::jsonb,
	"use_cases" jsonb DEFAULT '[]'::jsonb,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"approval_rules" jsonb,
	"config" jsonb,
	"risk_level" varchar(30) DEFAULT 'low',
	"can_read" boolean DEFAULT false,
	"can_write" boolean DEFAULT false,
	"can_delete" boolean DEFAULT false,
	"can_execute" boolean DEFAULT true,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "tools_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"agentCredits" integer DEFAULT 3,
	"ussageCredits" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agentConfig" ADD CONSTRAINT "agentConfig_email_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agentRun" ADD CONSTRAINT "agentRun_agentId_agentConfig_agentId_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agentConfig"("agentId") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "creditLedger" ADD CONSTRAINT "creditLedger_email_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."users"("email") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unique_agent_occurrence" ON "agentRun" USING btree ("agentId","scheduled_for");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_schedule_lookup" ON "agentRun" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_idempotency_key" ON "creditLedger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_user_time" ON "creditLedger" USING btree ("email","created_at");
--> statement-breakpoint
-- agentRun.credit_cost: added separately because the table may already exist.
ALTER TABLE "agentRun" ADD COLUMN IF NOT EXISTS "credit_cost" integer DEFAULT 1 NOT NULL;
