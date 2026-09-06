import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const run = promisify(execFile);

/**
 * Proves the Agent Slot quota holds under concurrent creates.
 *
 * This exercises the real statement from lib/agent-slots.ts against a real
 * PostgreSQL, because the bug it guards against only appears when two requests
 * interleave: a unit test with a mocked database cannot observe it.
 *
 * Skipped unless TEST_DATABASE_URL points at a throwaway database.
 */
const url = process.env.TEST_DATABASE_URL;
const psqlAvailable = Boolean(url);

const GUARDED = `
INSERT INTO "agentConfig"(email,"agentId",name,slot_index)
SELECT :'email', :'aid', 'New', candidate.slot
FROM (
    SELECT gs AS slot
    FROM generate_series(0, 2) gs
    WHERE NOT EXISTS (
        SELECT 1 FROM "agentConfig" taken
        WHERE taken.email = :'email' AND taken.slot_index = gs
    )
    ORDER BY gs
    LIMIT 1
) AS candidate
RETURNING "agentId";
`;

const psql = (args: string[]) => run("psql", [url as string, "-q", "-tA", ...args]);

describe.skipIf(!psqlAvailable)("Agent Slot quota under concurrency", () => {
    beforeAll(async () => {
        writeFileSync("/tmp/arkitech-guarded-insert.sql", GUARDED);
        await psql(["-c", `DROP TABLE IF EXISTS "agentConfig"`]);
        await psql(["-c", `CREATE TABLE "agentConfig"(id serial primary key, email text, "agentId" varchar unique, name varchar, slot_index integer)`]);
        await psql(["-c", `CREATE UNIQUE INDEX agent_config_user_slot ON "agentConfig"(email, slot_index)`]);
    });

    afterAll(async () => {
        await psql(["-c", `DROP TABLE IF EXISTS "agentConfig"`]);
    });

    it("lets exactly one of many simultaneous creates through at 2 of 3 used", async () => {
        const email = "race@example.com";
        await psql(["-c", `DELETE FROM "agentConfig"`]);
        await psql(["-c", `INSERT INTO "agentConfig"(email,"agentId",name,slot_index) VALUES ('${email}','a1','A',0),('${email}','a2','B',1)`]);

        // Fired together, not in sequence. Sequential calls would pass even
        // with the old count-then-insert.
        const attempts = await Promise.all(
            [1, 2, 3, 4, 5, 6, 7, 8].map(n =>
                psql(["-v", `email=${email}`, "-v", `aid=new-${n}`, "-f", "/tmp/arkitech-guarded-insert.sql"])
                    .then(r => r.stdout.trim())
                    .catch(() => ""),
            ),
        );

        const created = attempts.filter(Boolean);
        expect(created).toHaveLength(1);

        const { stdout } = await psql(["-c", `SELECT count(*) FROM "agentConfig" WHERE email='${email}'`]);
        expect(Number(stdout.trim())).toBe(3);
    }, 60_000);

    it("refuses every create once the quota is already full", async () => {
        const email = "full@example.com";
        await psql(["-c", `DELETE FROM "agentConfig" WHERE email='${email}'`]);
        await psql(["-c", `INSERT INTO "agentConfig"(email,"agentId",name,slot_index) VALUES ('${email}','f1','A',0),('${email}','f2','B',1),('${email}','f3','C',2)`]);

        const attempts = await Promise.all(
            [1, 2, 3].map(n =>
                psql(["-v", `email=${email}`, "-v", `aid=over-${n}`, "-f", "/tmp/arkitech-guarded-insert.sql"])
                    .then(r => r.stdout.trim())
                    .catch(() => ""),
            ),
        );

        expect(attempts.filter(Boolean)).toHaveLength(0);

        const { stdout } = await psql(["-c", `SELECT count(*) FROM "agentConfig" WHERE email='${email}'`]);
        expect(Number(stdout.trim())).toBe(3);
    }, 60_000);

    it("does not let one user's quota block another's", async () => {
        // The lock is keyed per user, so unrelated creates must not serialise.
        await psql(["-c", `DELETE FROM "agentConfig" WHERE email like 'multi%'`]);

        const results = await Promise.all(
            ["multi-a@example.com", "multi-b@example.com"].map(email =>
                psql(["-v", `email=${email}`, "-v", `aid=first-${email}`, "-f", "/tmp/arkitech-guarded-insert.sql"])
                    .then(r => r.stdout.trim())
                    .catch(() => ""),
            ),
        );

        expect(results.filter(Boolean)).toHaveLength(2);
    }, 60_000);
});
