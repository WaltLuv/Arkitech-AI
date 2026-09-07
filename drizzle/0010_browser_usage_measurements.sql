-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
ALTER TABLE "browserRun" ADD COLUMN IF NOT EXISTS "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "browserRun" ADD COLUMN IF NOT EXISTS "artifact_bytes" bigint;--> statement-breakpoint
ALTER TABLE "browserSession" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
