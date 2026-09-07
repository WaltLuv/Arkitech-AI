/**
 * The operator's verbs: Watch, Pause, Take control, Return to agent, Stop.
 *
 * Each one is owner-scoped in its query, records what happened in the
 * activity trail, and changes control through `control.ts`, so the fencing
 * generation moves on every handover. Nothing here talks to the browser; the
 * worker and the input route do that only after checking the lease.
 */
import { browserRun, browserSession, db } from "@/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { recordEventWithRetry } from "./activity";
import {
    authorizeInput,
    grantControl,
    renewControl,
    revokeControl,
    type AuthorizeResult,
    type HolderKind,
} from "./control";
import { requestCancellation } from "./queue";

export type OwnedBrowserRun = typeof browserRun.$inferSelect;

/**
 * A missing run and another user's run look the same, for the same reason
 * Agent ownership works that way: telling them apart leaks which ids exist.
 */
export async function loadOwnedBrowserRun(
    browserRunId: string | null | undefined,
    userEmail: string,
): Promise<OwnedBrowserRun | null> {
    if (!browserRunId || !userEmail) return null;
    if (!/^[0-9a-f-]{36}$/i.test(browserRunId)) return null;

    const rows = await db
        .select()
        .from(browserRun)
        .where(and(eq(browserRun.id, browserRunId), eq(browserRun.userEmail, userEmail)));

    return rows[0] ?? null;
}

/** The newest session record for a run, if any. Never the provider's URLs. */
export async function latestSessionForRun(browserRunId: string, userEmail: string) {
    const rows = await db
        .select({
            id: browserSession.id,
            status: browserSession.status,
            releaseState: browserSession.releaseState,
            browserbaseSessionId: browserSession.browserbaseSessionId,
            createdAt: browserSession.createdAt,
            releasedAt: browserSession.releasedAt,
        })
        .from(browserSession)
        .where(and(eq(browserSession.browserRunId, browserRunId), eq(browserSession.userEmail, userEmail)))
        .orderBy(desc(browserSession.createdAt))
        .limit(1);

    return rows[0] ?? null;
}

export type ControllerView = {
    kind: HolderKind;
    generation: number;
    expiresAt: string | null;
};

/** Who holds control right now, as the UI should show it. Never the holder id. */
export async function currentController(browserRunId: string, userEmail: string): Promise<ControllerView> {
    const result = await db.execute(sql`
        SELECT "holder_kind", "generation", "expires_at"
        FROM "browserControlLease"
        WHERE "browser_run_id" = ${browserRunId}::uuid AND "email" = ${userEmail}
    `);

    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { kind: "none", generation: 0, expiresAt: null };

    const expiresAt = row.expires_at ? new Date(row.expires_at as string) : null;
    const expired = expiresAt !== null && expiresAt.getTime() <= Date.now();

    return {
        kind: expired ? "none" : (row.holder_kind as HolderKind),
        generation: Number(row.generation),
        expiresAt: expiresAt?.toISOString() ?? null,
    };
}

/**
 * How many runs the queue will serve before this one. Mirrors the claim
 * order exactly: urgent first, then oldest, then id.
 */
export async function queuePosition(run: OwnedBrowserRun): Promise<number | null> {
    if (run.status !== "queued") return null;

    const result = await db.execute(sql`
        SELECT count(*) AS ahead
        FROM "browserRun"
        WHERE "status" = 'queued'
          AND "cancel_requested_at" IS NULL
          AND (
            ("priority" = 'urgent') > (${run.priority} = 'urgent')
            OR (
              ("priority" = 'urgent') = (${run.priority} = 'urgent')
              AND ("queued_at", "id") < (${run.queuedAt.toISOString()}::timestamptz, ${run.id}::uuid)
            )
          )
    `);

    const row = result.rows?.[0] as { ahead?: string | number } | undefined;
    return Number(row?.ahead ?? 0) + 1;
}

export type OperatorOutcome =
    | { ok: true; generation: number; channelId?: string; expiresAt?: string | null }
    | { ok: false; status: 404 | 409; error: string };

const NOT_FOUND: OperatorOutcome = { ok: false, status: 404, error: "Browser run not found" };

function conflict(error: string): OperatorOutcome {
    return { ok: false, status: 409, error };
}

const ACTIVE = new Set(["claimed", "running"]);

/**
 * Pause: the agent may not issue further input. The lease moves to nobody,
 * which the worker sees before its next action. The session stays open and
 * the run stays the same run.
 */
export async function pauseAgent(browserRunId: string, userEmail: string): Promise<OperatorOutcome> {
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NOT_FOUND;
    if (!ACTIVE.has(run.status)) return conflict(`Run is ${run.status}, not running`);

    const controller = await currentController(run.id, userEmail);
    if (controller.kind !== "agent") return conflict("The agent does not hold control");

    const generation = await revokeControl({
        browserRunId: run.id,
        userEmail,
        expectedGeneration: controller.generation,
    });
    if (generation === null) return conflict("Control changed hands; refresh and try again");

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "paused", actor: "human",
        detail: { generation },
    });

    return { ok: true, generation };
}

/** Resume from a pause: a fresh agent generation, nobody else fenced out. */
export async function resumeAgent(browserRunId: string, userEmail: string): Promise<OperatorOutcome> {
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NOT_FOUND;
    if (!ACTIVE.has(run.status)) return conflict(`Run is ${run.status}, not running`);
    if (!run.claimedBy) return conflict("No worker holds this run");

    const controller = await currentController(run.id, userEmail);
    if (controller.kind !== "none") return conflict(`Control is held by the ${controller.kind}`);

    const lease = await grantControl({
        browserRunId: run.id,
        userEmail,
        holderKind: "agent",
        holderId: run.claimedBy,
        expectedGeneration: controller.generation,
    });
    if (!lease) return conflict("Control changed hands; refresh and try again");

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "agent_control_restored", actor: "human",
        detail: { generation: lease.generation, from: "paused" },
    });

    return { ok: true, generation: lease.generation };
}

/**
 * Take control. One statement grants the human and fences the agent, so
 * there is no instant with two controllers and none with a stale agent
 * generation still valid.
 *
 * The channel id is minted here and returned only to this caller. A second
 * tab of the same user, even one that knows the generation, is not the
 * holder: it has a different channel, and its input is refused.
 */
export async function takeControl(
    browserRunId: string,
    userEmail: string,
    expectedGeneration?: number,
): Promise<OperatorOutcome> {
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NOT_FOUND;
    if (!ACTIVE.has(run.status)) return conflict(`Run is ${run.status}, not running`);

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "takeover_requested", actor: "human",
    });

    const channelId = `human-${randomBytes(12).toString("hex")}`;
    const lease = await grantControl({
        browserRunId: run.id,
        userEmail,
        holderKind: "human",
        holderId: channelId,
        expectedGeneration,
    });
    if (!lease) return conflict("Control changed hands; refresh and try again");

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "human_control", actor: "human",
        detail: { generation: lease.generation },
    });

    return {
        ok: true,
        generation: lease.generation,
        channelId,
        expiresAt: lease.expiresAt?.toISOString() ?? null,
    };
}

/**
 * Return to agent. The write that issues the agent's generation is the write
 * that supersedes the human's, so the old tab cannot type after this. The
 * worker, on seeing its new generation, refreshes the page state, takes a
 * fresh screenshot and discards whatever it had proposed before.
 */
export async function returnToAgentControl(
    browserRunId: string,
    userEmail: string,
    expectedGeneration?: number,
): Promise<OperatorOutcome> {
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NOT_FOUND;
    if (!ACTIVE.has(run.status)) return conflict(`Run is ${run.status}, not running`);
    if (!run.claimedBy) return conflict("No worker holds this run");

    const controller = await currentController(run.id, userEmail);
    if (controller.kind === "agent") return conflict("The agent already holds control");

    const lease = await grantControl({
        browserRunId: run.id,
        userEmail,
        holderKind: "agent",
        holderId: run.claimedBy,
        expectedGeneration: expectedGeneration ?? controller.generation,
    });
    if (!lease) return conflict("Control changed hands; refresh and try again");

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "agent_control_restored", actor: "human",
        detail: { generation: lease.generation, from: "human" },
    });

    return { ok: true, generation: lease.generation };
}

/**
 * Stop. Cancellation is requested and every controller is fenced out in the
 * same breath, so neither the agent nor a human tab issues anything further.
 * The worker releases the session and finishes the run as cancelled.
 */
export async function stopRun(browserRunId: string, userEmail: string): Promise<OperatorOutcome> {
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NOT_FOUND;

    const requested = await requestCancellation(run.id, userEmail);
    if (!requested) return conflict(`Run is ${run.status} and cannot be stopped`);

    const generation = await revokeControl({ browserRunId: run.id, userEmail });

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "cancelled", actor: "human",
        detail: { generation: generation ?? 0, previousStatus: run.status },
    });

    return { ok: true, generation: generation ?? 0 };
}

/**
 * The check the input route makes, then a renewal so an active person is
 * not timed out mid-task. Renewal is conditional on the same generation, so
 * it can never revive a lease that has moved on.
 */
export async function authorizeHumanInput(params: {
    browserRunId: string;
    userEmail: string;
    channelId: string;
    generation: number;
}): Promise<AuthorizeResult> {
    const result = await authorizeInput({
        browserRunId: params.browserRunId,
        userEmail: params.userEmail,
        holderKind: "human",
        holderId: params.channelId,
        generation: params.generation,
    });

    if (result.allowed) {
        await renewControl({
            browserRunId: params.browserRunId,
            userEmail: params.userEmail,
            holderId: params.channelId,
            generation: params.generation,
        });
    }

    return result;
}
