import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

/**
 * Control fencing, exercised against a real PostgreSQL. What matters here is
 * what happens when two actors act at once, which a mocked database cannot
 * show. The SQL below is the same SQL `control.ts` issues; if the two drift,
 * these tests stop proving anything, so keep them in step.
 */
const SEP = "##";
const psql = (s: string) =>
    run("psql", [url as string, "-q", "-tA", "-F", SEP, "-c", s]).then(r => r.stdout.trim());

const RUN_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const OWNER = "owner@example.com";

/** Mirrors grantControl: one statement that both fences and hands over. */
const grant = (kind: string, holder: string, expected: string = "NULL", ms = 120000) => `
INSERT INTO "browserControlLease"("browser_run_id","email","holder_kind","holder_id","generation","expires_at","updated_at")
SELECT '${RUN_ID}'::uuid,'${OWNER}','${kind}','${holder}',1,
       now() + (${ms} || ' milliseconds')::interval, now()
WHERE ${expected}::integer IS NULL
   OR EXISTS (SELECT 1 FROM "browserControlLease" WHERE "browser_run_id"='${RUN_ID}'::uuid)
ON CONFLICT ("browser_run_id") DO UPDATE
SET "holder_kind"=EXCLUDED."holder_kind","holder_id"=EXCLUDED."holder_id",
    "generation"="browserControlLease"."generation"+1,
    "expires_at"=EXCLUDED."expires_at","updated_at"=now()
WHERE "browserControlLease"."email"='${OWNER}'
  AND (${expected}::integer IS NULL OR "browserControlLease"."generation" = ${expected}::integer)
RETURNING "generation";`;

/** Mirrors revokeControl. */
const revoke = () => `
UPDATE "browserControlLease" SET "holder_kind"='none',"holder_id"=NULL,
  "generation"="generation"+1,"expires_at"=NULL,"updated_at"=now()
WHERE "browser_run_id"='${RUN_ID}'::uuid AND "email"='${OWNER}' RETURNING "generation";`;

const generationNow = async () =>
    Number(await psql(`SELECT "generation" FROM "browserControlLease"`));

/** Mirrors authorizeInput, expiry included, decided from one row snapshot. */
const authorize = async (kind: string, holder: string, generation: number) => {
    const out = await psql(`SELECT "holder_kind","holder_id","generation",
        ("expires_at" IS NOT NULL AND "expires_at" <= now())::text
        FROM "browserControlLease"
        WHERE "browser_run_id"='${RUN_ID}'::uuid AND "email"='${OWNER}'`);
    if (!out) return "no_lease";

    const [holderKind, holderId, gen, expired] = out.split(SEP);
    if (holderKind !== kind || holderId !== holder) return "not_holder";
    if (Number(gen) !== generation) return "stale_generation";
    if (expired === "true") return "expired";
    return "allowed";
};

describe.skipIf(!url)("browser control fencing", () => {
    beforeAll(async () => {
        await psql(`DROP TABLE IF EXISTS "browserControlLease"`);
        await psql(`CREATE TABLE "browserControlLease"(
            browser_run_id uuid primary key, email text not null,
            holder_kind varchar(10) not null, holder_id varchar(200),
            generation integer not null default 0,
            expires_at timestamptz, updated_at timestamptz not null default now())`);
    });

    afterAll(async () => { await psql(`DROP TABLE IF EXISTS "browserControlLease"`); });

    beforeEach(async () => { await psql(`DELETE FROM "browserControlLease"`); });

    it("lets exactly one of many simultaneous takeovers win", async () => {
        await psql(grant("agent", "worker-1"));
        const seen = await generationNow();

        // Six humans that all read the same generation and all press Take
        // Control. Only the first write can still match it.
        const results = await Promise.all(
            [1, 2, 3, 4, 5, 6].map(n =>
                psql(grant("human", `human-${n}`, String(seen))).catch(() => "")),
        );

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await generationNow()).toBe(seen + 1);
    }, 60_000);

    it("refuses a takeover naming a generation that has already moved", async () => {
        await psql(grant("agent", "worker-1"));
        const stale = await generationNow();

        await psql(grant("human", "human-1", String(stale)));

        expect(await psql(grant("human", "human-2", String(stale)))).toBe("");
        expect(await authorize("human", "human-1", stale + 1)).toBe("allowed");
    }, 60_000);

    it("refuses a generation-guarded grant when no lease exists at all", async () => {
        // Nothing to fence: creating a fresh lease here would report success to
        // a caller that believes it is superseding somebody.
        expect(await psql(grant("human", "human-1", "3"))).toBe("");
        expect(await psql(`SELECT count(*) FROM "browserControlLease"`)).toBe("0");
    }, 60_000);

    it("refuses an actor holding a superseded generation", async () => {
        await psql(grant("agent", "worker-1"));
        const before = await generationNow();

        await psql(revoke());
        await psql(grant("human", "human-1"));

        expect(await authorize("agent", "worker-1", before)).toBe("not_holder");
    }, 60_000);

    it("refuses the old human channel once control returns to the agent", async () => {
        await psql(grant("human", "human-1"));
        const humanGen = await generationNow();

        await psql(grant("agent", "worker-1", String(humanGen)));

        expect(await authorize("human", "human-1", humanGen)).toBe("not_holder");
    }, 60_000);

    it("refuses the agent's own superseded generation after a human takes over", async () => {
        await psql(grant("agent", "worker-1"));
        const agentGen = await generationNow();

        await psql(grant("human", "human-1", String(agentGen)));
        await psql(grant("agent", "worker-1", String(agentGen + 1)));

        // The worker resumes on the generation it held before the interruption.
        expect(await authorize("agent", "worker-1", agentGen)).toBe("stale_generation");
        expect(await authorize("agent", "worker-1", agentGen + 2)).toBe("allowed");
    }, 60_000);

    it("refuses an expired lease even for the correct holder", async () => {
        await psql(grant("human", "human-1", "NULL", -1000));
        const gen = await generationNow();

        expect(await authorize("human", "human-1", gen)).toBe("expired");
    }, 60_000);

    it("never reports two holders at once", async () => {
        await psql(grant("agent", "worker-1"));
        await psql(revoke());
        await psql(grant("human", "human-1"));

        const rows = await psql(`SELECT count(*) FROM "browserControlLease"
            WHERE browser_run_id='${RUN_ID}'::uuid AND holder_kind <> 'none'`);
        expect(Number(rows)).toBe(1);
    }, 60_000);

    it("refuses a different owner entirely", async () => {
        await psql(grant("agent", "worker-1"));

        const other = await psql(`UPDATE "browserControlLease" SET holder_id='intruder'
            WHERE browser_run_id='${RUN_ID}'::uuid AND email='someone-else@example.com'
            RETURNING generation`).catch(() => "");
        expect(other).toBe("");
        expect(await authorize("agent", "worker-1", await generationNow())).toBe("allowed");
    }, 60_000);

    it("leaves nobody in control after a revoke", async () => {
        await psql(grant("agent", "worker-1"));
        await psql(revoke());

        expect(await psql(`SELECT holder_kind FROM "browserControlLease"`)).toBe("none");
        expect(await authorize("agent", "worker-1", await generationNow())).toBe("not_holder");
    }, 60_000);
});
