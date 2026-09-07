import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

/**
 * The statements in `limits.ts`, executed against a real PostgreSQL.
 *
 * The unit tests beside this file mock the database, so they prove the
 * surrounding logic but cannot see whether the SQL parses or whether an
 * interval comparison, a cast or an aggregate actually does what it reads
 * like. These are the same statements; if the two drift, keep them in step.
 */
const SCHEMA = "arkitech_test_browser_limits";
const psqlEnv = { ...process.env, PGOPTIONS: `-csearch_path=${SCHEMA}` };

const psql = (s: string) =>
    run("psql", [url as string, "-q", "-tA", "-F", "##", "-c", s], { env: psqlEnv }).then(r => r.stdout.trim());

/** Mirrors reconcileSlotCapacity. */
const reconcileSlots = (limit: number) => `
INSERT INTO "browserSlot" ("slot_index")
SELECT gs FROM generate_series(0, ${limit - 1}) gs
ON CONFLICT ("slot_index") DO NOTHING;
DELETE FROM "browserSlot" WHERE "slot_index" >= ${limit} AND "browser_run_id" IS NULL;
SELECT count(*) FROM "browserSlot";`;

/** Mirrors sweepOverrunningRuns' statement. */
const stopOverrunning = (maxRunMs: number) => `
UPDATE "browserRun"
SET "cancel_requested_at" = COALESCE("cancel_requested_at", now()),
    "status" = 'cancelled',
    "ended_at" = now(),
    "failure_reason" = 'Stopped after exceeding the maximum run duration'
WHERE "status" IN ('claimed', 'running')
  AND "started_at" IS NOT NULL
  AND "started_at" < now() - (${maxRunMs} || ' milliseconds')::interval
RETURNING "id";`;

/** Mirrors failExhaustedRuns' statement. */
const failExhausted = (maxAttempts: number) => `
UPDATE "browserRun"
SET "status" = 'failed', "ended_at" = now(), "failure_reason" = 'Gave up after ${maxAttempts} attempts'
WHERE "status" IN ('queued', 'claimed') AND "attempt" >= ${maxAttempts}
RETURNING "id";`;

/** Mirrors recordRunUsage. */
const recordUsage = (runId: string) => `
UPDATE "browserRun" r
SET "duration_ms" = CASE
        WHEN r."started_at" IS NULL THEN NULL
        ELSE GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(r."ended_at", now()) - r."started_at")) * 1000)::bigint)::integer
    END,
    "artifact_bytes" = COALESCE((
        SELECT SUM(octet_length(b."bytes"))
        FROM "browserArtifactBlob" b
        JOIN "browserArtifact" a ON a."id" = b."artifact_id"
        WHERE a."browser_run_id" = r."id"
    ), 0)
WHERE r."id" = '${runId}'::uuid
RETURNING r."duration_ms", r."artifact_bytes";`;

/** Mirrors browserUsageForOwner. */
const usageForOwner = (email: string) => `
SELECT count(*), COALESCE(SUM("duration_ms"), 0), COALESCE(SUM("artifact_bytes"), 0),
       COUNT(*) FILTER (WHERE "status" IN ('queued', 'claimed', 'running'))
FROM "browserRun" WHERE "email" = '${email}';`;

const OWNER = "owner@example.com";
const RUN = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe.skipIf(!url)("browser limits SQL", () => {
    beforeAll(async () => {
        await psql(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
        await psql(`
            CREATE TABLE "browserSlot"(slot_index integer primary key, browser_run_id uuid, claimed_at timestamptz);
            CREATE TABLE "browserRun"(
                id uuid primary key, email text not null, "agentId" varchar, task text,
                status varchar(20) not null default 'queued', priority varchar(10) not null default 'normal',
                cancel_requested_at timestamptz, attempt integer not null default 0,
                claimed_by varchar(100), failure_reason text, result text,
                duration_ms integer, artifact_bytes bigint,
                queued_at timestamptz not null default now(), claimed_at timestamptz,
                started_at timestamptz, ended_at timestamptz);
            CREATE TABLE "browserArtifact"(id uuid primary key, browser_run_id uuid not null, email text not null);
            CREATE TABLE "browserArtifactBlob"(artifact_id uuid primary key, email text not null, bytes bytea not null);`);
    });

    afterAll(async () => { await psql(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); });

    beforeEach(async () => {
        await psql(`DELETE FROM "browserArtifactBlob"; DELETE FROM "browserArtifact";
                    DELETE FROM "browserSlot"; DELETE FROM "browserRun";`);
    });

    it("grows and shrinks capacity to the configured cap", async () => {
        expect(await psql(reconcileSlots(1))).toBe("1");
        expect(await psql(reconcileSlots(4))).toBe("4");
        expect(await psql(reconcileSlots(2))).toBe("2");
    }, 60_000);

    it("never removes a slot that is holding a run", async () => {
        await psql(reconcileSlots(3));
        await psql(`UPDATE "browserSlot" SET browser_run_id='${RUN(1)}'::uuid WHERE slot_index=2`);

        // Shrinking to one leaves the busy slot until its run finishes.
        expect(await psql(reconcileSlots(1))).toBe("2");

        await psql(`UPDATE "browserSlot" SET browser_run_id=NULL WHERE slot_index=2`);
        expect(await psql(reconcileSlots(1))).toBe("1");
    }, 60_000);

    it("stops only the runs that have actually overrun", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,started_at) VALUES
            ('${RUN(1)}','${OWNER}','running', now() - interval '30 minutes'),
            ('${RUN(2)}','${OWNER}','running', now() - interval '1 minute'),
            ('${RUN(3)}','${OWNER}','completed', now() - interval '30 minutes'),
            ('${RUN(4)}','${OWNER}','queued', NULL)`);

        const stopped = await psql(stopOverrunning(20 * 60 * 1000));

        expect(stopped.split("\n").filter(Boolean)).toEqual([RUN(1)]);
        expect(await psql(`SELECT status FROM "browserRun" WHERE id='${RUN(2)}'::uuid`)).toBe("running");
        expect(await psql(`SELECT status FROM "browserRun" WHERE id='${RUN(3)}'::uuid`)).toBe("completed");
    }, 60_000);

    it("marks a stopped run as cancel-requested so its worker is fenced", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,started_at)
            VALUES ('${RUN(1)}','${OWNER}','running', now() - interval '30 minutes')`);

        await psql(stopOverrunning(20 * 60 * 1000));

        expect(await psql(`SELECT (cancel_requested_at IS NOT NULL)::text FROM "browserRun" WHERE id='${RUN(1)}'::uuid`)).toBe("true");
    }, 60_000);

    it("gives up on a run that has been claimed too many times", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,attempt) VALUES
            ('${RUN(1)}','${OWNER}','queued',3),
            ('${RUN(2)}','${OWNER}','queued',1),
            ('${RUN(3)}','${OWNER}','running',9)`);

        const failed = await psql(failExhausted(3));

        expect(failed.split("\n").filter(Boolean)).toEqual([RUN(1)]);
        // A run already executing is left to finish or be swept as overrunning.
        expect(await psql(`SELECT status FROM "browserRun" WHERE id='${RUN(3)}'::uuid`)).toBe("running");
    }, 60_000);

    it("computes duration and artifact bytes for a finished run", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,started_at,ended_at)
            VALUES ('${RUN(1)}','${OWNER}','completed', now() - interval '5 minutes', now())`);
        await psql(`INSERT INTO "browserArtifact"(id,browser_run_id,email) VALUES
            ('${RUN(7)}','${RUN(1)}','${OWNER}'), ('${RUN(8)}','${RUN(1)}','${OWNER}')`);
        await psql(`INSERT INTO "browserArtifactBlob"(artifact_id,email,bytes) VALUES
            ('${RUN(7)}','${OWNER}', repeat('x', 1000)::bytea),
            ('${RUN(8)}','${OWNER}', repeat('y', 24)::bytea)`);

        const [duration, bytes] = (await psql(recordUsage(RUN(1)))).split("##");

        expect(Number(duration)).toBeGreaterThanOrEqual(299_000);
        expect(Number(duration)).toBeLessThanOrEqual(301_000);
        expect(Number(bytes)).toBe(1024);
    }, 60_000);

    it("records zero bytes, not null, for a run that left no evidence", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,started_at,ended_at)
            VALUES ('${RUN(1)}','${OWNER}','failed', now() - interval '10 seconds', now())`);

        const [, bytes] = (await psql(recordUsage(RUN(1)))).split("##");
        expect(Number(bytes)).toBe(0);
    }, 60_000);

    it("leaves duration null for a run that never started", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status) VALUES ('${RUN(1)}','${OWNER}','failed')`);

        const [duration] = (await psql(recordUsage(RUN(1)))).split("##");
        expect(duration).toBe("");
    }, 60_000);

    it("totals one owner's usage and counts only that owner's active runs", async () => {
        await psql(`INSERT INTO "browserRun"(id,email,status,duration_ms,artifact_bytes) VALUES
            ('${RUN(1)}','${OWNER}','completed',60000,1024),
            ('${RUN(2)}','${OWNER}','running',5000,0),
            ('${RUN(3)}','someone-else@example.com','completed',999999,999999)`);

        const [runs, duration, bytes, active] = (await psql(usageForOwner(OWNER))).split("##");

        expect(Number(runs)).toBe(2);
        expect(Number(duration)).toBe(65000);
        expect(Number(bytes)).toBe(1024);
        expect(Number(active)).toBe(1);
    }, 60_000);
});
