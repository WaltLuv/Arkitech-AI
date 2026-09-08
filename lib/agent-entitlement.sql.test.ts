import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
    AGENT_SLOT_PLAN_TIERS,
    MAX_AGENT_SLOT_ENTITLEMENT,
    PLAN_INCLUDED_AGENT_SLOTS,
} from "@/lib/agent-entitlement";
import { effectiveLimitSql } from "@/lib/agent-slots";

const migration = readFileSync("drizzle/0012_agent_slot_entitlement.sql", "utf8");
const claimModule = readFileSync("lib/agent-slots.ts", "utf8");

/**
 * The plan numbers exist once, in agent-entitlement.ts. These tests are what
 * stops the copies that cannot import it, the CHECK constraint in the
 * migration, from drifting away from it silently.
 */
describe("The entitlement expression the database is handed", () => {
    it("prices every plan exactly as the constant does", () => {
        const sql = effectiveLimitSql();

        for (const tier of AGENT_SLOT_PLAN_TIERS) {
            expect(sql).toContain(`WHEN '${tier}' THEN ${PLAN_INCLUDED_AGENT_SLOTS[tier]}`);
        }
    });

    it("falls back to Starter for a plan it does not recognise", () => {
        expect(effectiveLimitSql()).toContain(`ELSE ${PLAN_INCLUDED_AGENT_SLOTS.starter}`);
    });

    it("clamps to the ceiling so no stored value can size a generate_series", () => {
        expect(effectiveLimitSql()).toContain(`LEAST(\n        ${MAX_AGENT_SLOT_ENTITLEMENT}`);
        expect(effectiveLimitSql()).toContain(`<= ${MAX_AGENT_SLOT_ENTITLEMENT}`);
    });

    it("never produces a negative upper bound", () => {
        expect(effectiveLimitSql()).toContain("GREATEST(");
    });
});

describe("The claim statement", () => {
    it("reads the entitlement from the users table, not from an argument", () => {
        // A quota parameter is a quota a caller can get wrong and a client can
        // try to inject. There is deliberately no longer one.
        expect(claimModule).toContain('FROM "users" u');
        expect(claimModule).not.toMatch(/quota\?\s*:/);
        expect(claimModule).not.toMatch(/values\.quota/);
    });

    it("bounds the slots it will consider by that entitlement", () => {
        expect(claimModule).toContain("generate_series(0, e.effective_limit - 1)");
    });

    it("refuses while occupied is at or above the limit, which is what stops a downgraded account refilling", () => {
        expect(claimModule).toMatch(/SELECT count\(\*\) FROM "agentConfig" occupied[\s\S]*?\) < e\.effective_limit/);
    });

    it("still claims the lowest free slot and still leans on the unique index", () => {
        // The occupancy guard adds a refusal. It does not replace the
        // structural claim, which is what decides who wins a contested slot.
        expect(claimModule).toContain("ORDER BY gs");
        expect(claimModule).toContain('code === "23505"');
    });
});

describe("The entitlement migration", () => {
    it("uses the same ceiling as the constant", () => {
        expect(migration).toContain(
            `"agent_slot_override" >= 0 AND "agent_slot_override" <= ${MAX_AGENT_SLOT_ENTITLEMENT}`,
        );
    });

    it("allows exactly the plans the code knows", () => {
        const listed = AGENT_SLOT_PLAN_TIERS.map(tier => `'${tier}'`).join(", ");
        expect(migration).toContain(`"plan_tier" IN (${listed})`);
    });

    it("defaults existing accounts to Starter, which is the capacity they had", () => {
        expect(migration).toContain(`UPDATE "users" SET "plan_tier" = 'starter' WHERE "plan_tier" IS NULL`);
    });

    it("can be replayed without failing", () => {
        // Duplicate migration runs happen. Every statement here tolerates one.
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS "plan_tier"');
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS "agent_slot_override"');
        expect(migration).toContain('DROP COLUMN IF EXISTS "agentCredits"');
        expect(migration.match(/SELECT 1 FROM pg_constraint WHERE conname/g)).toHaveLength(2);
    });

    it("does not touch a single Agent", () => {
        // Existing Agents are facts. A downgrade does not renumber them, and
        // this migration is not allowed to either.
        expect(migration).not.toMatch(/UPDATE "agentConfig"/);
        expect(migration).not.toMatch(/DELETE FROM "agentConfig"/);
        expect(migration).not.toMatch(/slot_index/);
    });

    it("leaves Usage Credits alone", () => {
        // Named in a comment, never in a statement: Usage Credits are a
        // different concept and this migration does not touch the column.
        expect(migration).not.toMatch(/(ALTER|UPDATE|DROP)[^;]*ussageCredits/i);
    });
});

describe("agentCredits", () => {
    it("is gone from the schema rather than left beside a real entitlement", () => {
        // It had no reader and no writer. Two fields that can disagree is how
        // the disagreement eventually ships.
        expect(readFileSync("db/schema.ts", "utf8")).not.toMatch(/agentCredits/);
    });
});
