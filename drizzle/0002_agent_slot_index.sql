-- Agent Slot enforcement at the database boundary.
--
-- The quota was previously a count followed by an insert, which two concurrent
-- creates at 2 of 3 both pass. Locking does not fix it: a count reads the
-- statement snapshot taken before the lock is acquired, so a waiter still sees
-- the old total. Both an advisory lock and SELECT FOR UPDATE were measured
-- against a real PostgreSQL and both still exceeded the quota.
--
-- Each Agent instead takes a slot index, unique per user. Concurrent claimants
-- of the same index collide on this index, so exactly one wins.
ALTER TABLE "agentConfig" ADD COLUMN IF NOT EXISTS "slot_index" integer;
--> statement-breakpoint

-- Backfill deterministically by creation order. A user already over quota keeps
-- every Agent and simply has no free index below the quota, so they are
-- grandfathered rather than having Agents removed.
UPDATE "agentConfig" a
SET "slot_index" = ranked.rn - 1
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "email" ORDER BY "created_at", "id") AS rn
	FROM "agentConfig"
) ranked
WHERE a."id" = ranked."id" AND a."slot_index" IS NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_config_user_slot"
	ON "agentConfig" USING btree ("email", "slot_index");
