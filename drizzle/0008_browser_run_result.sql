-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
ALTER TABLE "browserRun" ADD COLUMN IF NOT EXISTS "result" text;
