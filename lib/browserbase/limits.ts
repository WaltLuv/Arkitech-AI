/**
 * What browser work is allowed to cost, and the sweeps that hold it there.
 *
 * Every bound in this file exists because the failure it prevents costs real
 * money: a session nobody released, a run that never ends, a worker that died
 * holding a slot, a retry loop that opens a fresh browser each time.
 *
 * Measurement lives here too. It is measurement only. Browser work is paid for
 * by the Run's existing Usage Credit charge, and nothing in this module writes
 * a Ledger Entry or changes a price.
 */
import { browserRun, browserSession, db } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { recordEventWithRetry } from "./activity";
import { revokeControl } from "./control";
import { releaseBrowserSlot } from "./queue";
import { findAbandonedSessions, releaseSessionForRecord } from "./session";

export type BrowserLimits = {
    /** How many browser sessions may be held at once. */
    slotLimit: number;
    /** How long one run may hold a browser before it is stopped. */
    maxRunMs: number;
    /** How long a provider session may live before it is swept. */
    maxSessionMs: number;
    /** How many times a run may be claimed before it is given up on. */
    maxAttempts: number;
};

export const DEFAULT_LIMITS: BrowserLimits = {
    slotLimit: 1,
    maxRunMs: 20 * 60 * 1000,
    maxSessionMs: 30 * 60 * 1000,
    maxAttempts: 3,
};

/** Bounds on the bounds: a typo in the environment must not uncap anything. */
const CEILINGS = { slotLimit: 20, maxRunMs: 2 * 60 * 60 * 1000, maxSessionMs: 3 * 60 * 60 * 1000, maxAttempts: 10 };

function positiveInt(raw: string | undefined, fallback: number, ceiling: number): number {
    if (raw === undefined) return fallback;
    const value = Number(raw.trim());
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return fallback;
    return Math.min(value, ceiling);
}

export function readBrowserLimits(env: NodeJS.ProcessEnv = process.env): BrowserLimits {
    return {
        slotLimit: positiveInt(env.BROWSER_SLOT_LIMIT, DEFAULT_LIMITS.slotLimit, CEILINGS.slotLimit),
        maxRunMs: positiveInt(env.BROWSER_MAX_RUN_MS, DEFAULT_LIMITS.maxRunMs, CEILINGS.maxRunMs),
        maxSessionMs: positiveInt(env.BROWSER_MAX_SESSION_MS, DEFAULT_LIMITS.maxSessionMs, CEILINGS.maxSessionMs),
        maxAttempts: positiveInt(env.BROWSER_MAX_ATTEMPTS, DEFAULT_LIMITS.maxAttempts, CEILINGS.maxAttempts),
    };
}

/**
 * Makes the number of slot rows match the configured cap.
 *
 * Capacity is the number of rows, not a number in code, because that is what
 * makes two workers unable to both take the last slot. Shrinking removes only
 * free rows: a slot with a run in it is left alone and removed on a later
 * sweep, once that run has finished.
 */
export async function reconcileSlotCapacity(limit = readBrowserLimits().slotLimit): Promise<number> {
    await db.execute(sql`
        INSERT INTO "browserSlot" ("slot_index")
        SELECT gs FROM generate_series(0, ${limit - 1}) gs
        ON CONFLICT ("slot_index") DO NOTHING
    `);

    await db.execute(sql`
        DELETE FROM "browserSlot"
        WHERE "slot_index" >= ${limit} AND "browser_run_id" IS NULL
    `);

    const result = await db.execute(sql`SELECT count(*) AS total FROM "browserSlot"`);
    const row = result.rows?.[0] as { total?: string | number } | undefined;
    return Number(row?.total ?? 0);
}

/** Milliseconds a run has held a browser, from the moment it started. */
export function runDurationMs(startedAt: Date | null, endedAt: Date | null, now = new Date()): number | null {
    if (!startedAt) return null;
    return Math.max(0, (endedAt ?? now).getTime() - startedAt.getTime());
}

/**
 * Writes what this run consumed: how long it held a browser and how many bytes
 * of evidence it left behind. Called when a run finishes.
 */
export async function recordRunUsage(browserRunId: string): Promise<{ durationMs: number | null; artifactBytes: number }> {
    const result = await db.execute(sql`
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
        WHERE r."id" = ${browserRunId}::uuid
        RETURNING r."duration_ms", r."artifact_bytes"
    `);

    const row = result.rows?.[0] as { duration_ms?: number | null; artifact_bytes?: string | number } | undefined;
    return {
        durationMs: row?.duration_ms == null ? null : Number(row.duration_ms),
        artifactBytes: Number(row?.artifact_bytes ?? 0),
    };
}

/** Writes how long a provider session was held. Called on release. */
export async function recordSessionDuration(sessionRecordId: string): Promise<number | null> {
    const result = await db.execute(sql`
        UPDATE "browserSession"
        SET "duration_ms" = GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE("released_at", now()) - "created_at")) * 1000)::bigint)::integer
        WHERE "id" = ${sessionRecordId}::uuid
        RETURNING "duration_ms"
    `);

    const row = result.rows?.[0] as { duration_ms?: number } | undefined;
    return row?.duration_ms == null ? null : Number(row.duration_ms);
}

export type SweepReport = {
    overrunningRuns: number;
    abandonedSessions: number;
    exhaustedRuns: number;
    slots: number;
};

/**
 * Runs that have held a browser longer than the maximum.
 *
 * Cancellation is requested and control is revoked in the same pass, so the
 * worker is fenced out at its next action rather than being asked politely to
 * stop. The session is released and the slot freed here too, because the
 * reason a run overran may be that its worker is gone.
 */
export async function sweepOverrunningRuns(limits = readBrowserLimits()): Promise<number> {
    const overrunning = await db.execute(sql`
        UPDATE "browserRun"
        SET "cancel_requested_at" = COALESCE("cancel_requested_at", now()),
            "status" = 'cancelled',
            "ended_at" = now(),
            "failure_reason" = ${`Stopped after exceeding the maximum run duration of ${Math.round(limits.maxRunMs / 60000)} minutes`}
        WHERE "status" IN ('claimed', 'running')
          AND "started_at" IS NOT NULL
          AND "started_at" < now() - (${limits.maxRunMs} || ' milliseconds')::interval
        RETURNING "id", "email"
    `);

    const rows = (overrunning.rows ?? []) as Array<{ id: string; email: string }>;

    for (const row of rows) {
        await revokeControl({ browserRunId: row.id, userEmail: row.email }).catch(() => undefined);

        const sessions = await db
            .select({ id: browserSession.id })
            .from(browserSession)
            .where(and(
                eq(browserSession.browserRunId, row.id),
                sql`${browserSession.status} IN ('pending', 'running', 'unknown')`,
            ));

        for (const session of sessions) {
            await releaseSessionForRecord(session.id).catch(() => false);
            await recordSessionDuration(session.id).catch(() => null);
        }

        await releaseBrowserSlot(row.id).catch(() => undefined);
        await recordRunUsage(row.id).catch(() => null);

        await recordEventWithRetry({
            browserRunId: row.id, userEmail: row.email, kind: "cancelled", actor: "system",
            detail: { reason: "max_run_duration_exceeded", maxRunMs: limits.maxRunMs },
        }).catch(() => null);
    }

    return rows.length;
}

/**
 * Sessions still open past their maximum lifetime, or belonging to a run that
 * already finished. This is the safety net for a worker that died holding one:
 * a session nobody released is a session still being paid for.
 */
export async function sweepAbandonedSessions(limits = readBrowserLimits()): Promise<number> {
    const abandoned = await findAbandonedSessions(limits.maxSessionMs);

    const orphaned = await db.execute(sql`
        SELECT s."id", s."email"
        FROM "browserSession" s
        JOIN "browserRun" r ON r."id" = s."browser_run_id"
        WHERE s."status" IN ('pending', 'running')
          AND r."status" IN ('completed', 'failed', 'cancelled')
    `);

    const targets = new Map<string, string>();
    for (const session of abandoned) targets.set(session.id, session.userEmail);
    for (const row of (orphaned.rows ?? []) as Array<{ id: string; email: string }>) {
        targets.set(row.id, row.email);
    }

    for (const [sessionRecordId, userEmail] of targets) {
        const released = await releaseSessionForRecord(sessionRecordId).catch(() => false);
        await recordSessionDuration(sessionRecordId).catch(() => null);

        const owner = await db
            .select({ browserRunId: browserSession.browserRunId })
            .from(browserSession)
            .where(eq(browserSession.id, sessionRecordId));

        const runId = owner[0]?.browserRunId;
        if (runId) {
            await recordEventWithRetry({
                browserRunId: runId, userEmail, browserSessionId: sessionRecordId,
                kind: "session_released", actor: "system",
                detail: { reason: "abandoned_session_sweep", released },
            }).catch(() => null);
        }
    }

    return targets.size;
}

/**
 * Runs that have been claimed too many times. Retrying is how a run survives a
 * worker dying, but every attempt opens a paid browser, so the attempts are
 * bounded and an exhausted run fails honestly rather than looping.
 */
export async function failExhaustedRuns(limits = readBrowserLimits()): Promise<number> {
    const exhausted = await db.execute(sql`
        UPDATE "browserRun"
        SET "status" = 'failed',
            "ended_at" = now(),
            "failure_reason" = ${`Gave up after ${limits.maxAttempts} attempts`}
        WHERE "status" IN ('queued', 'claimed')
          AND "attempt" >= ${limits.maxAttempts}
        RETURNING "id", "email"
    `);

    const rows = (exhausted.rows ?? []) as Array<{ id: string; email: string }>;

    for (const row of rows) {
        await releaseBrowserSlot(row.id).catch(() => undefined);
        await recordRunUsage(row.id).catch(() => null);
        await recordEventWithRetry({
            browserRunId: row.id, userEmail: row.email, kind: "failed", actor: "system",
            detail: { reason: "max_attempts_exhausted", attempts: limits.maxAttempts },
        }).catch(() => null);
    }

    return rows.length;
}

/** Everything above, in the order that frees the most for the least work. */
export async function sweepBrowserResources(limits = readBrowserLimits()): Promise<SweepReport> {
    const overrunningRuns = await sweepOverrunningRuns(limits);
    const exhaustedRuns = await failExhaustedRuns(limits);
    const abandonedSessions = await sweepAbandonedSessions(limits);
    const slots = await reconcileSlotCapacity(limits.slotLimit);

    return { overrunningRuns, exhaustedRuns, abandonedSessions, slots };
}

export type OwnerBrowserUsage = {
    runs: number;
    totalDurationMs: number;
    totalArtifactBytes: number;
    activeRuns: number;
};

/** What browser work has consumed for one owner. Scoped in the query. */
export async function browserUsageForOwner(userEmail: string): Promise<OwnerBrowserUsage> {
    const result = await db.execute(sql`
        SELECT
            count(*) AS runs,
            COALESCE(SUM("duration_ms"), 0) AS total_duration_ms,
            COALESCE(SUM("artifact_bytes"), 0) AS total_artifact_bytes,
            COUNT(*) FILTER (WHERE "status" IN ('queued', 'claimed', 'running')) AS active_runs
        FROM "browserRun"
        WHERE "email" = ${userEmail}
    `);

    const row = result.rows?.[0] as Record<string, string | number> | undefined;
    return {
        runs: Number(row?.runs ?? 0),
        totalDurationMs: Number(row?.total_duration_ms ?? 0),
        totalArtifactBytes: Number(row?.total_artifact_bytes ?? 0),
        activeRuns: Number(row?.active_runs ?? 0),
    };
}

/** Marks a run's own row as measured. Used by the worker when it finishes. */
export async function finaliseRunMeasurements(browserRunId: string, sessionRecordId?: string | null) {
    const usage = await recordRunUsage(browserRunId);
    if (sessionRecordId) await recordSessionDuration(sessionRecordId).catch(() => null);
    return usage;
}

/** Re-exported so callers do not import the run table just to name a status. */
export const ACTIVE_RUN_STATUSES = ["queued", "claimed", "running"] as const;

export type BrowserRunRow = typeof browserRun.$inferSelect;
