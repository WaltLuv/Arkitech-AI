/**
 * Browserbase session lifecycle.
 *
 * Three rules shape this file:
 *
 * 1. **A session is never kept alive to preserve Arkitech state.** Runs,
 *    transcripts and checkpoints live in Postgres and survive the browser
 *    ending. Keeping a paid session open to hold conversation state would be
 *    paying a provider to do something the database already does.
 *
 * 2. **An ambiguous create is never retried blindly.** The creation key is
 *    written before the provider is called, so a create whose response is lost
 *    can be reconciled against the provider. If reconciliation cannot settle
 *    it, the session is recorded as `unknown` for review rather than a second
 *    paid browser being created.
 *
 * 3. **Release is explicit.** Arkitech does not rely on a provider timeout to
 *    stop paying.
 */
import { browserSession, db } from "@/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
    createSession,
    findSessionByCreationKey,
    releaseSession,
    retrieveSession,
} from "./client";

export type SessionRecordStatus =
    | "pending"
    | "running"
    | "released"
    | "errored"
    | "timed_out"
    /** The provider may or may not hold a session. Needs a human or a sweep. */
    | "unknown";

export type SessionOutcome =
    | { ok: true; sessionRecordId: string; browserbaseSessionId: string }
    | { ok: false; reason: "not_configured" | "provider_failed"; message: string }
    | { ok: false; reason: "uncertain"; sessionRecordId: string; message: string };

/** Provider status maps onto the record's own vocabulary. */
export function mapProviderStatus(status: string): SessionRecordStatus {
    switch (status) {
        case "RUNNING":
        case "PENDING":
            return "running";
        case "COMPLETED":
            return "released";
        case "TIMED_OUT":
            return "timed_out";
        case "ERROR":
            return "errored";
        default:
            return "unknown";
    }
}

/**
 * Opens a session for a run.
 *
 * The record is inserted before the provider call, so there is always something
 * to reconcile against even if this process dies mid-request.
 */
export async function openSessionForRun(params: {
    browserRunId: string;
    userEmail: string;
    contextId?: string;
}): Promise<SessionOutcome> {
    const creationKey = `arkitech-${params.browserRunId}-${crypto.randomUUID()}`;

    const inserted = await db
        .insert(browserSession)
        .values({
            browserRunId: params.browserRunId,
            userEmail: params.userEmail,
            creationKey,
            browserbaseContextId: params.contextId ?? null,
            status: "pending",
        })
        .returning({ id: browserSession.id });

    const sessionRecordId = inserted[0].id;

    try {
        const created = await createSession({ creationKey, contextId: params.contextId });

        await db
            .update(browserSession)
            .set({
                browserbaseSessionId: created.id,
                status: mapProviderStatus(created.status),
            })
            .where(eq(browserSession.id, sessionRecordId));

        return { ok: true, sessionRecordId, browserbaseSessionId: created.id };
    } catch (error) {
        if ((error as { name?: string }).name === "BrowserbaseNotConfiguredError") {
            await db
                .update(browserSession)
                .set({ status: "errored" })
                .where(eq(browserSession.id, sessionRecordId));

            return {
                ok: false,
                reason: "not_configured",
                message: (error as Error).message,
            };
        }

        // The provider may already have created a session. Look before leaping.
        return reconcileUncertainCreate(sessionRecordId, creationKey, error as Error);
    }
}

/**
 * Decides what actually happened after a create whose outcome is unknown.
 *
 * Adopts the provider's session if the creation key finds one. Otherwise the
 * record is left `unknown`: no second session is created, because doing so is
 * how a timeout turns into two paid browsers.
 */
export async function reconcileUncertainCreate(
    sessionRecordId: string,
    creationKey: string,
    cause: Error,
): Promise<SessionOutcome> {
    try {
        const existing = await findSessionByCreationKey(creationKey);

        if (existing?.id) {
            await db
                .update(browserSession)
                .set({
                    browserbaseSessionId: existing.id,
                    status: mapProviderStatus(existing.status ?? ""),
                })
                .where(eq(browserSession.id, sessionRecordId));

            return { ok: true, sessionRecordId, browserbaseSessionId: existing.id };
        }
    } catch {
        // Reconciliation itself failed. That is still not licence to create a
        // second session; fall through to the uncertain state below.
    }

    await db
        .update(browserSession)
        .set({ status: "unknown" })
        .where(eq(browserSession.id, sessionRecordId));

    return {
        ok: false,
        reason: "uncertain",
        sessionRecordId,
        message:
            `Session creation outcome is unknown (${cause.message}). ` +
            `Recorded for review rather than creating a second session.`,
    };
}

/** Brings a record in line with what the provider says. */
export async function syncSessionStatus(sessionRecordId: string): Promise<SessionRecordStatus | null> {
    const rows = await db
        .select()
        .from(browserSession)
        .where(eq(browserSession.id, sessionRecordId));

    const record = rows[0];
    if (!record?.browserbaseSessionId) return null;

    const live = await retrieveSession(record.browserbaseSessionId);
    const status = mapProviderStatus(live.status ?? "");

    await db
        .update(browserSession)
        .set({ status })
        .where(eq(browserSession.id, sessionRecordId));

    return status;
}

/**
 * Ends a session and records that Arkitech asked for it.
 *
 * Failure to release is recorded rather than swallowed, so the sweep can retry
 * it: a session nobody released is a session still being paid for.
 */
export async function releaseSessionForRecord(sessionRecordId: string): Promise<boolean> {
    const rows = await db
        .select()
        .from(browserSession)
        .where(eq(browserSession.id, sessionRecordId));

    const record = rows[0];
    if (!record) return false;

    if (!record.browserbaseSessionId) {
        await db
            .update(browserSession)
            .set({ releaseState: "released", status: "released", releasedAt: new Date() })
            .where(eq(browserSession.id, sessionRecordId));
        return true;
    }

    await db
        .update(browserSession)
        .set({ releaseState: "requested" })
        .where(eq(browserSession.id, sessionRecordId));

    try {
        await releaseSession(record.browserbaseSessionId);

        await db
            .update(browserSession)
            .set({ releaseState: "released", status: "released", releasedAt: new Date() })
            .where(eq(browserSession.id, sessionRecordId));

        return true;
    } catch {
        await db
            .update(browserSession)
            .set({ releaseState: "failed" })
            .where(eq(browserSession.id, sessionRecordId));

        return false;
    }
}

/**
 * Sessions that outlived their usefulness: still open past the maximum lifetime,
 * or belonging to a run that already finished.
 *
 * This is the safety net for a worker that died holding a session.
 */
export async function findAbandonedSessions(maxLifetimeMs: number) {
    const cutoff = new Date(Date.now() - maxLifetimeMs);

    return db
        .select()
        .from(browserSession)
        .where(
            and(
                inArray(browserSession.status, ["pending", "running", "unknown"]),
                lt(browserSession.createdAt, cutoff),
            ),
        );
}

/** Sessions belonging to a run that has already reached a terminal state. */
export async function findSessionsForFinishedRuns() {
    const result = await db.execute(sql`
        SELECT s."id"
        FROM "browserSession" s
        JOIN "browserRun" r ON r."id" = s."browser_run_id"
        WHERE s."status" IN ('pending','running')
          AND r."status" IN ('completed','failed','cancelled')
    `);

    return (result.rows ?? []) as Array<{ id: string }>;
}
