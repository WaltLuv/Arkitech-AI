import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PgDialect } from "drizzle-orm/pg-core";
import { agentClaimQuery } from "@/lib/agent-slots";

const run = promisify(execFile);

/**
 * Runs the production claim statement against a real PostgreSQL.
 *
 * The concurrency suite proves the invariant holds when many callers race, but
 * it drives psql with SQL of its own. This takes the query the route actually
 * executes, serialises it, and hands it to the server, so a statement that no
 * longer parses or no longer type-checks fails here rather than in production.
 *
 * Skipped unless TEST_DATABASE_URL points at a throwaway database.
 */
const url = process.env.TEST_DATABASE_URL;

const SCHEMA = "arkitech_test_claim_statement";
const psqlEnv = { ...process.env, PGOPTIONS: `-csearch_path=${SCHEMA}` };

const psql = (args: string[]) =>
    run("psql", [url as string, "-q", "-tA", "-v", "ON_ERROR_STOP=1", ...args], { env: psqlEnv });

const claimFor = (email: string, agentId: string) =>
    agentClaimQuery({
        userEmail: email,
        agentId,
        agentImage: "https://example.com/a.svg",
        name: "Axe",
        description: null,
        instructions: null,
        objective: null,
        tools: ["markets"],
        skills: null,
        schedule: { type: "recurring" },
        outputFormat: null,
        status: "active",
    });

/** The statement and its parameters, exactly as the driver would send them. */
const serialise = (email: string, agentId: string) => new PgDialect().sqlToQuery(claimFor(email, agentId));

/**
 * PREPARE makes PostgreSQL parse and plan the statement without running it, so
 * a syntax or type error is caught even before behaviour is considered.
 */
const prepareAndRun = async (email: string, agentId: string) => {
    const { sql: text, params } = serialise(email, agentId);
    const literals = params
        .map(p => (p === null ? "NULL" : `'${String(p).replace(/'/g, "''")}'`))
        .join(", ");

    // One session, because a prepared statement does not outlive the
    // connection that made it.
    const { stdout } = await psql([
        "-c",
        `PREPARE claim AS ${text}; EXECUTE claim(${literals});`,
    ]);

    return stdout.trim();
};

describe.skipIf(!url)("The claim statement PostgreSQL is actually given", () => {
    beforeAll(async () => {
        await psql(["-c", `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`]);
        await psql(["-c", `DROP TABLE IF EXISTS "agentConfig"`]);
        await psql(["-c", `DROP TABLE IF EXISTS "users"`]);
        await psql(["-c", `CREATE TABLE "users"(id serial primary key, email text unique, plan_tier varchar(20) DEFAULT 'starter', agent_slot_override integer)`]);
        await psql([
            "-c",
            `CREATE TABLE "agentConfig"(
                id serial primary key, email text, "agentId" varchar unique, "agentImage" varchar,
                name varchar, description text, instructions text, objective text,
                tools jsonb, skills jsonb, schedule jsonb, "outputFormat" text,
                status varchar, slot_index integer,
                created_at timestamp default now()
            )`,
        ]);
        await psql(["-c", `CREATE UNIQUE INDEX agent_config_user_slot ON "agentConfig"(email, slot_index)`]);
    });

    afterAll(async () => {
        await psql(["-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`]);
    });

    it("parses and plans, so the raw expression and the parameters agree", async () => {
        // The entitlement expression is spliced in as text while the values
        // are bound. PREPARE is what proves the two still form one statement.
        const { sql: text, params } = serialise("prepare@example.com", "a-prepare");

        await psql(["-c", `INSERT INTO "users"(email, plan_tier) VALUES ('prepare@example.com','starter')`]);
        await expect(psql(["-c", `PREPARE p_check AS ${text}`])).resolves.toBeTruthy();

        expect(params.length).toBeGreaterThan(0);
    });

    it("creates an Agent in the lowest free slot", async () => {
        await psql(["-c", `DELETE FROM "agentConfig"`]);
        await psql(["-c", `DELETE FROM "users" WHERE email='live@example.com'`]);
        await psql(["-c", `INSERT INTO "users"(email, plan_tier) VALUES ('live@example.com','starter')`]);

        expect(await prepareAndRun("live@example.com", "live-1")).not.toBe("");

        const { stdout } = await psql(["-c", `SELECT slot_index FROM "agentConfig" WHERE "agentId"='live-1'`]);
        expect(stdout.trim()).toBe("0");
    });

    it("writes the jsonb columns rather than failing on them", async () => {
        const { stdout } = await psql(["-c", `SELECT tools::text FROM "agentConfig" WHERE "agentId"='live-1'`]);
        expect(stdout.trim()).toContain("markets");
    });

    it("refuses once Starter's three slots are occupied", async () => {
        await prepareAndRun("live@example.com", "live-2");
        await prepareAndRun("live@example.com", "live-3");

        expect(await prepareAndRun("live@example.com", "live-4")).toBe("");

        const { stdout } = await psql(["-c", `SELECT count(*) FROM "agentConfig" WHERE email='live@example.com'`]);
        expect(stdout.trim()).toBe("3");
    });

    it("follows the account's plan when it changes", async () => {
        await psql(["-c", `UPDATE "users" SET plan_tier='pro' WHERE email='live@example.com'`]);

        expect(await prepareAndRun("live@example.com", "live-5")).not.toBe("");

        const { stdout } = await psql(["-c", `SELECT slot_index FROM "agentConfig" WHERE "agentId"='live-5'`]);
        expect(stdout.trim()).toBe("3");
    });

    it("refuses when the account has no row at all", async () => {
        expect(await prepareAndRun("nobody@example.com", "nobody-1")).toBe("");
    });
});
