import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { PLAN_INCLUDED_AGENT_SLOTS } from "@/lib/agent-entitlement";
import { effectiveLimitSql } from "@/lib/agent-slots";

const run = promisify(execFile);

/**
 * Proves the Agent Slot entitlement holds under concurrent creates.
 *
 * This exercises the real statement from lib/agent-slots.ts against a real
 * PostgreSQL, because the bug it guards against only appears when two requests
 * interleave: a unit test with a mocked database cannot observe it.
 *
 * The entitlement expression is imported rather than transcribed, so a change
 * to the plan numbers or to the clamping is exercised here rather than quietly
 * diverging from what production runs.
 *
 * Skipped unless TEST_DATABASE_URL points at a throwaway database.
 */
const url = process.env.TEST_DATABASE_URL;
const psqlAvailable = Boolean(url);

const GUARDED = `
WITH entitlement AS (
    SELECT ${effectiveLimitSql()} AS effective_limit
    FROM "users" u
    WHERE u."email" = :'email'
)
INSERT INTO "agentConfig"(email,"agentId",name,slot_index)
SELECT :'email', :'aid', 'New', candidate.slot
FROM entitlement e
CROSS JOIN LATERAL (
    SELECT gs AS slot
    FROM generate_series(0, e.effective_limit - 1) gs
    WHERE NOT EXISTS (
        SELECT 1 FROM "agentConfig" taken
        WHERE taken.email = :'email' AND taken.slot_index = gs
    )
    ORDER BY gs
    LIMIT 1
) AS candidate
WHERE (
    SELECT count(*) FROM "agentConfig" occupied WHERE occupied.email = :'email'
) < e.effective_limit
RETURNING "agentId";
`;

/**
 * Everything below runs in its own schema, created here and dropped at the
 * end. These tests build the tables they need by hand, so sharing `public`
 * with a migrated database would mean dropping tables other things depend on.
 */
const SCHEMA = "arkitech_test_agent_slots";
const psqlEnv = { ...process.env, PGOPTIONS: `-csearch_path=${SCHEMA}` };

const psql = (args: string[]) =>
    run("psql", [url as string, "-q", "-tA", "-v", "ON_ERROR_STOP=1", ...args], { env: psqlEnv });

/** Creates the account and the Agents it already has, at slots 0..count-1. */
const seed = async (options: {
    email: string;
    planTier?: string | null;
    override?: number | null;
    occupied: number;
    withUserRow?: boolean;
}) => {
    const { email, planTier = "starter", override = null, occupied } = options;

    await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}'`]);
    await psql(["-c", `DELETE FROM "users" WHERE email='${email}'`]);

    if (options.withUserRow !== false) {
        await psql([
            "-c",
            `INSERT INTO "users"(email, plan_tier, agent_slot_override) VALUES ('${email}', ${planTier === null ? "NULL" : `'${planTier}'`}, ${override === null ? "NULL" : override})`,
        ]);
    }

    if (occupied > 0) {
        const rows = Array.from({ length: occupied }, (_, i) => `('${email}','seed-${email}-${i}','A',${i})`).join(",");
        await psql(["-c", `INSERT INTO "agentConfig"(email,"agentId",name,slot_index) VALUES ${rows}`]);
    }
};

/** A lost race for a slot, which is the one thing worth retrying. */
const isSlotCollision = (stderr: unknown) =>
    String(stderr ?? "").includes("duplicate key value") &&
    String(stderr ?? "").includes("agent_config_user_slot");

/**
 * One create, retried on a slot collision exactly as `createAgentWithinEntitlement`
 * does.
 *
 * Without this the harness would not be testing what production runs. A caller
 * that loses a contested slot gets a unique violation, and in the real code
 * that is a retry, not a refusal: it recomputes the lowest free slot and tries
 * again. Modelling it here is also what makes these counts deterministic. A
 * bare psql call would turn every collision into a lost create, so how many of
 * twenty racers succeeded would depend on how the processes happened to be
 * scheduled.
 *
 * An empty result is a genuine refusal and is never retried.
 */
const createWithRetry = async (email: string, agentId: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const { stdout, stderr } = await psql([
                "-v", `email=${email}`,
                "-v", `aid=${agentId}`,
                "-f", "/tmp/arkitech-guarded-insert.sql",
            ]);

            if (isSlotCollision(stderr)) continue;

            return stdout.trim();
        } catch (error) {
            if (!isSlotCollision((error as { stderr?: string }).stderr)) return "";
        }
    }

    return "";
};

/** Fires `count` creates at once and returns how many actually created an Agent. */
const raceCreates = async (email: string, count: number, tag: string) => {
    const attempts = await Promise.all(
        Array.from({ length: count }, (_, n) => createWithRetry(email, `${tag}-${n}`)),
    );

    return attempts.filter(Boolean).length;
};

const occupiedCount = async (email: string) => {
    const { stdout } = await psql(["-c", `SELECT count(*) FROM "agentConfig" WHERE email='${email}'`]);
    return Number(stdout.trim());
};

describe.skipIf(!psqlAvailable)("Agent Slots against a real PostgreSQL", () => {
    beforeAll(async () => {
        writeFileSync("/tmp/arkitech-guarded-insert.sql", GUARDED);
        await psql(["-c", `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`]);
        await psql(["-c", `DROP TABLE IF EXISTS "agentConfig"`]);
        await psql(["-c", `DROP TABLE IF EXISTS "users"`]);
        await psql(["-c", `CREATE TABLE "users"(id serial primary key, email text unique, plan_tier varchar(20) DEFAULT 'starter', agent_slot_override integer)`]);
        await psql(["-c", `CREATE TABLE "agentConfig"(id serial primary key, email text, "agentId" varchar unique, name varchar, slot_index integer)`]);
        await psql(["-c", `CREATE UNIQUE INDEX agent_config_user_slot ON "agentConfig"(email, slot_index)`]);
    });

    afterAll(async () => {
        await psql(["-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`]);
    });

    describe("Agent Slot entitlement under concurrency", () => {
    /**
     * Each plan is checked one below its limit and exactly at it. The boundary
     * is the case that regresses, and the plan numbers come from the constant
     * so a plan repriced in code is repriced here.
     */
    describe.each([
        ["Starter", "starter", PLAN_INCLUDED_AGENT_SLOTS.starter],
        ["Pro", "pro", PLAN_INCLUDED_AGENT_SLOTS.pro],
        ["Business", "business", PLAN_INCLUDED_AGENT_SLOTS.business],
    ])("%s", (label, planTier, limit) => {
        it(`lets exactly one of many simultaneous creates through at ${limit - 1} of ${limit}`, async () => {
            const email = `${planTier}-boundary@example.com`;
            await seed({ email, planTier, occupied: limit - 1 });

            // Fired together, not in sequence. Sequential calls would pass
            // even with the old count-then-insert.
            const created = await raceCreates(email, 12, "b");

            expect(created).toBe(1);
            expect(await occupiedCount(email)).toBe(limit);
        }, 120_000);

        it(`refuses every create once ${limit} of ${limit} are occupied`, async () => {
            const email = `${planTier}-full@example.com`;
            await seed({ email, planTier, occupied: limit });

            const created = await raceCreates(email, 12, "f");

            expect(created).toBe(0);
            expect(await occupiedCount(email)).toBe(limit);
        }, 120_000);
    });

    it("never exceeds the limit when many creates race into several free slots", async () => {
        // Five free slots and far more callers than slots: the interleaving
        // that produced seven Agents at a quota of three.
        const email = "pro-multi@example.com";
        await seed({ email, planTier: "pro", occupied: 5 });

        const created = await raceCreates(email, 20, "m");

        expect(created).toBe(5);
        expect(await occupiedCount(email)).toBe(10);
    }, 120_000);

    it("holds the boundary across repeated runs, not just a lucky one", async () => {
        // A race that passes once has not been shown to hold.
        for (let attempt = 0; attempt < 5; attempt++) {
            const email = `repeat-${attempt}@example.com`;
            await seed({ email, planTier: "business", occupied: 24 });

            expect(await raceCreates(email, 12, `r${attempt}`)).toBe(1);
            expect(await occupiedCount(email)).toBe(25);
        }
    }, 240_000);
});

    describe("An account left over its entitlement by a downgrade", () => {
    const email = "downgraded@example.com";

    /**
     * 14 Agents on a plan of 10. Every one of them stays: the account is
     * refused a fifteenth, never relieved of a fifth.
     */
    it("keeps all 14 Agents and refuses every create at 14 of 10", async () => {
        await seed({ email, planTier: "pro", occupied: 14 });

        const created = await raceCreates(email, 12, "d14");

        expect(created).toBe(0);
        expect(await occupiedCount(email)).toBe(14);
    }, 120_000);

    it("keeps the high slot indexes exactly where they are", async () => {
        await seed({ email, planTier: "pro", occupied: 14 });
        await raceCreates(email, 6, "d14b");

        const { stdout } = await psql([
            "-c",
            `SELECT string_agg(slot_index::text, ',' ORDER BY slot_index) FROM "agentConfig" WHERE email='${email}'`,
        ]);

        // Slots 10 to 13 are above the new limit and are left alone. Tidying
        // them would rewrite live allocation state for appearance.
        expect(stdout.trim()).toBe("0,1,2,3,4,5,6,7,8,9,10,11,12,13");
    }, 120_000);

    it("still refuses at exactly 10 of 10", async () => {
        await seed({ email, planTier: "pro", occupied: 10 });

        expect(await raceCreates(email, 12, "d10")).toBe(0);
        expect(await occupiedCount(email)).toBe(10);
    }, 120_000);

    it("allows exactly one create once it drops to 9 of 10", async () => {
        await seed({ email, planTier: "pro", occupied: 9 });

        expect(await raceCreates(email, 12, "d9")).toBe(1);
        expect(await occupiedCount(email)).toBe(10);
    }, 120_000);

    /**
     * The defect the occupancy guard exists for. Without it, freeing a low
     * index while still over entitlement leaves a slot inside [0, limit) that
     * the structural claim would happily fill, so the account climbs back to
     * 14 one deletion at a time.
     */
    it("refuses to refill a freed low slot while still over entitlement", async () => {
        await seed({ email, planTier: "pro", occupied: 14 });
        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index=5`]);

        expect(await occupiedCount(email)).toBe(13);

        const created = await raceCreates(email, 12, "refill");

        expect(created).toBe(0);
        expect(await occupiedCount(email)).toBe(13);
    }, 120_000);

    it("refuses just the same when a high slot is freed", async () => {
        await seed({ email, planTier: "pro", occupied: 14 });
        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index=13`]);

        expect(await raceCreates(email, 12, "refillhigh")).toBe(0);
        expect(await occupiedCount(email)).toBe(13);
    }, 120_000);

    it("only opens up once deletions bring it below the entitlement", async () => {
        // 14 down to 10 is still refused; the fifth deletion is what frees a
        // slot, and exactly one caller gets it.
        await seed({ email, planTier: "pro", occupied: 14 });

        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index IN (0,1,2,3)`]);
        expect(await raceCreates(email, 8, "still")).toBe(0);
        expect(await occupiedCount(email)).toBe(10);

        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index = 4`]);
        expect(await raceCreates(email, 8, "open")).toBe(1);
        expect(await occupiedCount(email)).toBe(10);
    }, 120_000);
});

    describe("Deleting and creating at the limit", () => {
    it("replaces exactly one Agent when a slot is freed at the limit", async () => {
        const email = "replace@example.com";
        await seed({ email, planTier: "starter", occupied: 3 });

        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index=1`]);

        expect(await raceCreates(email, 10, "rep")).toBe(1);
        expect(await occupiedCount(email)).toBe(3);
    }, 120_000);

    it("gives the freed index back rather than growing the numbering", async () => {
        const email = "reuse@example.com";
        await seed({ email, planTier: "starter", occupied: 3 });
        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}' AND slot_index=1`]);
        await raceCreates(email, 1, "reuse");

        const { stdout } = await psql([
            "-c",
            `SELECT string_agg(slot_index::text, ',' ORDER BY slot_index) FROM "agentConfig" WHERE email='${email}'`,
        ]);

        expect(stdout.trim()).toBe("0,1,2");
    }, 120_000);
});

    describe("Entitlement read from the account, not the request", () => {
    it("gives an operator override the capacity its plan does not", async () => {
        const email = "owner@example.com";
        await seed({ email, planTier: "starter", override: 100, occupied: 3 });

        // Starter would refuse at 3. The override is what decides, and with
        // 97 slots free every one of these callers gets one.
        expect(await raceCreates(email, 12, "ovr")).toBe(12);
        expect(await occupiedCount(email)).toBe(15);
    }, 240_000);

    it("honours an override of exactly the ceiling", async () => {
        const email = "ceiling@example.com";
        await seed({ email, planTier: "starter", override: 100, occupied: 99 });

        expect(await raceCreates(email, 8, "ceil")).toBe(1);
        expect(await occupiedCount(email)).toBe(100);
    }, 240_000);

    it("ignores a stored override above the ceiling rather than obeying it", async () => {
        // A value the CHECK constraint would refuse, present anyway. The read
        // path falls back to the plan instead of sizing a generate_series by
        // whatever is in the column.
        const email = "absurd@example.com";
        await seed({ email, planTier: "starter", override: 2_000_000_000, occupied: 3 });

        expect(await raceCreates(email, 6, "absurd")).toBe(0);
        expect(await occupiedCount(email)).toBe(3);
    }, 120_000);

    it("ignores a negative stored override", async () => {
        const email = "negative@example.com";
        await seed({ email, planTier: "pro", override: -5, occupied: 9 });

        expect(await raceCreates(email, 6, "neg")).toBe(1);
        expect(await occupiedCount(email)).toBe(10);
    }, 120_000);

    it("treats an account with no plan as Starter", async () => {
        const email = "legacy@example.com";
        await seed({ email, planTier: null, occupied: 2 });

        expect(await raceCreates(email, 8, "legacy")).toBe(1);
        expect(await occupiedCount(email)).toBe(3);
    }, 120_000);

    it("treats an unrecognised plan as Starter", async () => {
        const email = "unknown-plan@example.com";
        await seed({ email, planTier: "enterprise_unlimited", occupied: 3 });

        expect(await raceCreates(email, 8, "unk")).toBe(0);
        expect(await occupiedCount(email)).toBe(3);
    }, 120_000);

    it("refuses entirely when there is no account row", async () => {
        // No entitlement to resolve is not an unlimited entitlement.
        const email = "ghost@example.com";
        await seed({ email, occupied: 0, withUserRow: false });

        expect(await raceCreates(email, 6, "ghost")).toBe(0);
        expect(await occupiedCount(email)).toBe(0);
    }, 120_000);

    it("freezes an account at zero without touching its Agents", async () => {
        const email = "frozen@example.com";
        await seed({ email, planTier: "business", override: 0, occupied: 4 });

        expect(await raceCreates(email, 6, "frozen")).toBe(0);
        expect(await occupiedCount(email)).toBe(4);
    }, 120_000);
});

    describe("Entitlement changing while creates are racing", () => {
    it("never exceeds the higher of the two limits during an upgrade", async () => {
        const email = "upgrading@example.com";
        await seed({ email, planTier: "starter", occupied: 3 });

        const upgrade = psql(["-c", `UPDATE "users" SET plan_tier='pro' WHERE email='${email}'`]);
        const creates = raceCreates(email, 12, "up");
        const [, created] = await Promise.all([upgrade, creates]);

        // Whichever order the statements land in, the account is somewhere
        // between its Starter and its Pro entitlement, never past Pro.
        const total = await occupiedCount(email);
        expect(created).toBeGreaterThanOrEqual(0);
        expect(total).toBeGreaterThanOrEqual(3);
        expect(total).toBeLessThanOrEqual(10);
    }, 120_000);

    it("never exceeds the higher of the two limits during a downgrade", async () => {
        const email = "downgrading@example.com";
        await seed({ email, planTier: "business", occupied: 24 });

        const downgrade = psql(["-c", `UPDATE "users" SET plan_tier='pro' WHERE email='${email}'`]);
        const creates = raceCreates(email, 12, "down");
        await Promise.all([downgrade, creates]);

        // A create whose statement began under Business may still land. What
        // must not happen is the account passing the Business limit, and no
        // create may succeed once the downgrade is visible to its statement.
        expect(await occupiedCount(email)).toBeLessThanOrEqual(25);

        expect(await raceCreates(email, 8, "after")).toBe(0);
    }, 120_000);
});
});
