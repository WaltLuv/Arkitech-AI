-- Agent Slot entitlement per account, replacing a universal quota of 3.
--
-- The quota was a constant every account shared. It becomes the Starter plan's
-- allotment: Starter 3, Pro 10, Business 25, Enterprise configured by override.
-- The numbers themselves live in lib/agent-entitlement.ts and are compiled into
-- the claim statement, so this migration stores only what an account is on.
--
-- Nothing here touches "agentConfig". Existing Agents keep their slot indexes,
-- including indexes at or above a smaller new entitlement: an account with 14
-- Agents and a limit of 10 keeps all 14, and is simply refused a fifteenth.
-- Renumbering to make the sequence look tidy would rewrite live allocation
-- state for cosmetic reasons.
--
-- Every statement is idempotent, so a replayed or duplicated migration is a
-- no-op rather than an error.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_tier" varchar(20) DEFAULT 'starter';
--> statement-breakpoint

-- Existing accounts become Starter, which is the entitlement they already had.
-- Nobody loses capacity at the migration itself.
UPDATE "users" SET "plan_tier" = 'starter' WHERE "plan_tier" IS NULL;
--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "agent_slot_override" integer;
--> statement-breakpoint

-- The plan must be one Arkitech recognises. A row that somehow holds anything
-- else still resolves to Starter on read, but it cannot be written here.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_tier_known'
	) THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_plan_tier_known"
			CHECK ("plan_tier" IS NULL OR "plan_tier" IN ('starter', 'pro', 'business', 'enterprise'));
	END IF;
END
$$;
--> statement-breakpoint

-- The override ceiling, kept equal to MAX_AGENT_SLOT_ENTITLEMENT in
-- lib/agent-entitlement.ts by lib/agent-entitlement.sql.test.ts. Zero is
-- allowed on purpose: it freezes an account without deleting an Agent.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'users_agent_slot_override_range'
	) THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_agent_slot_override_range"
			CHECK ("agent_slot_override" IS NULL OR ("agent_slot_override" >= 0 AND "agent_slot_override" <= 100));
	END IF;
END
$$;
--> statement-breakpoint

-- agentCredits had no reader and no writer anywhere in the codebase. It was a
-- second number that looked like an entitlement and never was one, and leaving
-- it beside a real entitlement is how the two come to disagree. Usage Credits
-- are a different concept and are untouched: they live in "ussageCredits" and
-- the Credit Ledger.
ALTER TABLE "users" DROP COLUMN IF EXISTS "agentCredits";
