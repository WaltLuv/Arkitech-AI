/**
 * Applies drizzle/*.sql to a database, in order, additively.
 *
 * This exists because the production database lives behind an egress boundary
 * the coding environment cannot cross, so the migration has to run from CI.
 * That makes it an unattended process holding a production credential, and the
 * safety properties matter more than the convenience:
 *
 *   - It refuses outright to run a migration containing a destructive
 *     statement. Every migration here is additive today, and a runner with a
 *     production URL is the wrong place to discover that one is not.
 *   - Each file applies in its own transaction, so a migration either lands
 *     whole or not at all.
 *   - Every migration in this repository is idempotent, so replaying the full
 *     set against an already-migrated database is a no-op rather than an
 *     error. That is what makes "apply all, in order, every time" safe, and it
 *     is why no bookkeeping table is needed.
 *   - Nothing prints the connection string. psql puts the host in some errors,
 *     so output is filtered before it is written.
 *
 *     node scripts/apply-migrations.mjs [--dry-run]
 */
import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const DRY_RUN = process.argv.includes("--dry-run");
const DIR = "drizzle";

const url = process.env.DATABASE_URL;

if (!url) {
    console.error("DATABASE_URL is not set. Set it as a repository secret.");
    process.exit(2);
}

/**
 * Statements that can destroy data. DROP INDEX and DROP CONSTRAINT are in
 * here too: they are recoverable, but a production runner is not the place to
 * decide that. A migration that genuinely needs one is a deliberate human
 * action, run by hand after review.
 */
const DESTRUCTIVE = [
    [/\bDROP\s+(TABLE|DATABASE|SCHEMA|COLUMN|INDEX|CONSTRAINT|TYPE|VIEW)\b/i, "DROP"],
    [/\bTRUNCATE\b/i, "TRUNCATE"],
    [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
    [/\bALTER\s+SYSTEM\b/i, "ALTER SYSTEM"],
];

/**
 * psql does not echo the connection string on failure: it names the host on
 * its own, once per resolved address. Redacting the whole URL therefore misses
 * the disclosure entirely, which is how this was found. So each component is
 * removed separately, and the host is removed before anything else, since the
 * IP addresses beside it identify the endpoint just as well.
 */
const parts = (() => {
    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname,
            user: parsed.username,
            password: parsed.password,
            database: parsed.pathname.replace(/^\//, ""),
        };
    } catch {
        // A malformed URL fails at connect time with its own message; the
        // literal-string pass below still covers it.
        return {};
    }
})();

const scrub = (text) => {
    let out = String(text ?? "");

    if (url.length >= 8) out = out.split(url).join("[redacted-DATABASE_URL]");

    for (const [label, value] of [
        ["host", parts.host],
        ["password", parts.password],
        ["user", parts.user],
        ["database", parts.database],
    ]) {
        // Short values match too much to replace safely; a Neon host, user or
        // database name is never this short.
        if (value && value.length >= 4) out = out.split(value).join(`[redacted-${label}]`);
    }

    return out
        .replace(/postgres(ql)?:\/\/[^\s"'<>]+/gi, "[redacted-connection-string]")
        .replace(/password=[^&\s"'<>]+/gi, "password=[redacted]")
        // The addresses psql prints alongside the host resolve back to it.
        .replace(/\(\d{1,3}(?:\.\d{1,3}){3}\)/g, "([redacted-address])")
        .replace(/\([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\)/gi, "([redacted-address])");
};

/**
 * psql waits forever on a host that never answers, which in CI means burning
 * the whole job budget with nothing to show. Both bounds are needed: the
 * first caps the TCP connect, the second a connection that opens and then
 * stalls. Applying a migration is allowed to take longer than describing one.
 */
const CONNECT_TIMEOUT_SECONDS = 15;

const psql = (args, { timeoutMs = 60_000 } = {}) =>
    run("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], {
        maxBuffer: 16 * 1024 * 1024,
        timeout: timeoutMs,
        env: { ...process.env, PGCONNECT_TIMEOUT: String(CONNECT_TIMEOUT_SECONDS) },
    });

const files = readdirSync(DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

if (files.length === 0) {
    console.error(`No .sql files found in ${DIR}/.`);
    process.exit(2);
}

// Every file is read and checked before any of them is applied. A destructive
// statement in the last migration must not be found halfway through the set.
const offences = [];

for (const name of files) {
    const body = readFileSync(join(DIR, name), "utf8");

    body.split("\n").forEach((line, index) => {
        // A commented line is documentation, not a statement.
        if (line.trim().startsWith("--")) return;

        for (const [pattern, label] of DESTRUCTIVE) {
            if (pattern.test(line)) {
                offences.push({ name, line: index + 1, label, text: line.trim() });
            }
        }
    });
}

if (offences.length > 0) {
    console.error("Refusing to run: these migrations are not additive.\n");
    for (const o of offences) {
        console.error(`  ${o.name}:${o.line}  ${o.label}  ${o.text}`);
    }
    console.error(
        "\nThis runner only applies additive migrations. Review and apply a" +
            "\ndestructive one by hand, against a database you have backed up.",
    );
    process.exit(3);
}

console.log(`${files.length} migration(s) checked, all additive:`);
for (const name of files) console.log(`  ${name}`);

// The pooled endpoint runs PgBouncer in transaction mode, which is right for
// the app and wrong for DDL. Worth saying out loud rather than failing oddly.
if (/-pooler\./.test(url)) {
    console.log(
        "\nNote: this looks like Neon's pooled endpoint. Migrations are more" +
            "\nreliable against the direct endpoint (the host without `-pooler`).",
    );
}

const describe = async () => {
    const { stdout } = await psql([
        "-tA",
        "-c",
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';",
    ]);
    return stdout.trim();
};

try {
    const { stdout: version } = await psql(["-tA", "-c", "SELECT version();"]);
    console.log(`\nConnected: ${version.trim().split(",")[0]}`);
    console.log(`Tables in public before: ${await describe()}`);
} catch (error) {
    // A timeout kills psql with a signal and leaves stderr empty, so say what
    // happened rather than printing nothing.
    const reason = error.killed
        ? `no answer within ${CONNECT_TIMEOUT_SECONDS}s. Check the host is reachable from this runner.`
        : scrub(error.stderr || error.message);

    console.error(`\nCould not connect: ${reason}`);
    process.exit(1);
}

if (DRY_RUN) {
    console.log("\nDry run: connected and verified, nothing applied.");
    process.exit(0);
}

for (const name of files) {
    process.stdout.write(`Applying ${name} ... `);

    try {
        // Per file, so a failure leaves that migration entirely unapplied
        // rather than half-applied.
        await psql(["--single-transaction", "-q", "-f", join(DIR, name)], {
            timeoutMs: 300_000,
        });
        console.log("ok");
    } catch (error) {
        console.log("failed");
        console.error(`\n${name} failed:\n${scrub(error.stderr || error.message)}`);
        console.error("\nNothing from this file was applied. Earlier files stand.");
        process.exit(1);
    }
}

console.log(`\nTables in public after: ${await describe()}`);
console.log("All migrations applied.");
