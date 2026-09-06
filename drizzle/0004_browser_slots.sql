-- Idempotent, matching the earlier migrations.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "browserSlot" (
	"slot_index" integer PRIMARY KEY NOT NULL,
	"browser_run_id" uuid,
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "browser_slot_run" ON "browserSlot" USING btree ("browser_run_id");
--> statement-breakpoint
-- Seed the default single slot. Raising BROWSER_SLOT_LIMIT means inserting more
-- rows; capacity is the number of rows, not a number in code.
INSERT INTO "browserSlot" ("slot_index") VALUES (0)
ON CONFLICT ("slot_index") DO NOTHING;
