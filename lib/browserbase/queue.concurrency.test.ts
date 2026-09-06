import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

/**
 * Concurrency behaviour of the browser queue, exercised against a real
 * PostgreSQL because interleaving is the whole point: a mocked database cannot
 * observe two workers racing.
 *
 * Skipped unless TEST_DATABASE_URL points at a throwaway database.
 */
const psql = (sqlText: string) =>
    run("psql", [url as string, "-q", "-tA", "-c", sqlText]).then(r => r.stdout.trim());

/** The claim statement from lib/browserbase/queue.ts. */
const CLAIM_RUN = (worker: string) => `
UPDATE "browserRun"
SET "status"='claimed', "claimed_by"='${worker}', "claimed_at"=now(), "attempt"="attempt"+1
WHERE "id" = (
    SELECT "id" FROM "browserRun"
    WHERE "status"='queued' AND "cancel_requested_at" IS NULL
    ORDER BY ("priority"='urgent') DESC, "queued_at", "id"
    LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING "id";`;

/** The slot statement from lib/browserbase/queue.ts. */
const ACQUIRE_SLOT = (runId: string) => `
UPDATE "browserSlot" SET "browser_run_id"='${runId}'::uuid, "claimed_at"=now()
WHERE "slot_index" = (
    SELECT "slot_index" FROM "browserSlot" WHERE "browser_run_id" IS NULL
    ORDER BY "slot_index" LIMIT 1 FOR UPDATE SKIP LOCKED
)
RETURNING "slot_index";`;

describe.skipIf(!url)("browser queue under concurrency", () => {
    beforeAll(async () => {
        await psql(`DROP TABLE IF EXISTS "browserRun"; DROP TABLE IF EXISTS "browserSlot";`);
        await psql(`CREATE TABLE "browserRun"(
            id uuid primary key default gen_random_uuid(), email text not null, "agentId" varchar not null,
            task text not null, status varchar(20) not null default 'queued',
            priority varchar(10) not null default 'normal', cancel_requested_at timestamptz,
            attempt integer not null default 0, claimed_by varchar(100), claimed_at timestamptz,
            queued_at timestamptz not null default now())`);
        await psql(`CREATE TABLE "browserSlot"(
            slot_index integer primary key, browser_run_id uuid unique, claimed_at timestamptz)`);
    });

    afterAll(async () => {
        await psql(`DROP TABLE IF EXISTS "browserRun"; DROP TABLE IF EXISTS "browserSlot";`);
    });

    beforeEach(async () => {
        await psql(`DELETE FROM "browserSlot"; DELETE FROM "browserRun";`);
        await psql(`INSERT INTO "browserSlot"(slot_index) VALUES (0)`);
    });

    const queueRun = (priority = "normal", queuedAt = "now()") =>
        psql(`INSERT INTO "browserRun"(email,"agentId",task,priority,queued_at)
              VALUES ('u@e.com','ag-1','t','${priority}',${queuedAt}) RETURNING id`);

    it("gives one queued run to exactly one of many racing workers", async () => {
        await queueRun();

        const claims = await Promise.all(
            [1, 2, 3, 4, 5, 6, 7, 8].map(n => psql(CLAIM_RUN(`w${n}`)).catch(() => "")),
        );

        expect(claims.filter(Boolean)).toHaveLength(1);
    }, 60_000);

    it("never lets two runs hold the single slot", async () => {
        const runs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => queueRun()));

        const acquired = await Promise.all(runs.map(id => psql(ACQUIRE_SLOT(id)).catch(() => "")));

        expect(acquired.filter(Boolean)).toHaveLength(1);
        expect(Number(await psql(`SELECT count(*) FROM "browserSlot" WHERE browser_run_id IS NOT NULL`))).toBe(1);
    }, 60_000);

    it("hands out every distinct run without duplication when several are queued", async () => {
        // Eight workers, four runs: each run claimed once, no run claimed twice.
        await Promise.all([1, 2, 3, 4].map(() => queueRun()));

        const claims = await Promise.all(
            [1, 2, 3, 4, 5, 6, 7, 8].map(n => psql(CLAIM_RUN(`w${n}`)).catch(() => "")),
        );

        const ids = claims.filter(Boolean);
        expect(ids).toHaveLength(4);
        expect(new Set(ids).size).toBe(4);
    }, 60_000);

    it("claims urgent before normal regardless of age", async () => {
        await queueRun("normal", "now() - interval '1 hour'");
        const urgent = await queueRun("urgent");

        expect(await psql(CLAIM_RUN("w1"))).toBe(urgent);
    }, 60_000);

    it("claims the oldest first within one priority", async () => {
        const oldest = await queueRun("normal", "now() - interval '2 hours'");
        await queueRun("normal", "now() - interval '1 hour'");

        expect(await psql(CLAIM_RUN("w1"))).toBe(oldest);
    }, 60_000);

    it("never claims a run whose cancellation was requested", async () => {
        const id = await queueRun();
        await psql(`UPDATE "browserRun" SET cancel_requested_at=now(), status='cancelled' WHERE id='${id}'`);

        const claims = await Promise.all([1, 2, 3, 4].map(n => psql(CLAIM_RUN(`w${n}`)).catch(() => "")));

        expect(claims.filter(Boolean)).toHaveLength(0);
    }, 60_000);

    it("frees capacity for the next run once a slot is released", async () => {
        const first = await queueRun();
        const second = await queueRun();

        expect(await psql(ACQUIRE_SLOT(first))).toBe("0");
        expect(await psql(ACQUIRE_SLOT(second)).catch(() => "")).toBe("");

        await psql(`UPDATE "browserSlot" SET browser_run_id=NULL, claimed_at=NULL WHERE browser_run_id='${first}'`);

        expect(await psql(ACQUIRE_SLOT(second))).toBe("0");
    }, 60_000);
});
