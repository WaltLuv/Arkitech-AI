/**
 * Browser control ownership.
 *
 * Exactly one actor may drive a run at any moment. That is enforced by a single
 * row per run plus a fencing generation, both checked inside the same statement
 * that grants or uses control. Reading the lease and then acting on it would
 * reintroduce exactly the gap the Agent Slot work measured.
 *
 * Every handover increments the generation, so an actor holding an older one is
 * refused. This is what stops a paused worker, or a human tab left open in
 * another window, from writing after control has moved on.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

export type HolderKind = "agent" | "human" | "none";

export type Lease = {
    browserRunId: string;
    holderKind: HolderKind;
    holderId: string | null;
    generation: number;
    expiresAt: Date | null;
};

export type AuthorizeResult =
    | { allowed: true; generation: number }
    | { allowed: false; reason: "no_lease" | "not_holder" | "stale_generation" | "expired" };

const DEFAULT_LEASE_MS = 2 * 60 * 1000;

/**
 * Grants control, fencing out whoever held it.
 *
 * Conditional on the generation the caller believes is current, so two
 * simultaneous takeovers cannot both succeed: the second sees a generation that
 * has already moved and is refused.
 */
export async function grantControl(params: {
    browserRunId: string;
    userEmail: string;
    holderKind: Exclude<HolderKind, "none">;
    holderId: string;
    expectedGeneration?: number;
    leaseMs?: number;
}): Promise<Lease | null> {
    const leaseMs = params.leaseMs ?? DEFAULT_LEASE_MS;
    const expected = params.expectedGeneration ?? null;

    const result = await db.execute(sql`
        INSERT INTO "browserControlLease" (
            "browser_run_id", "email", "holder_kind", "holder_id",
            "generation", "expires_at", "updated_at"
        )
        SELECT
            ${params.browserRunId}::uuid, ${params.userEmail},
            ${params.holderKind}, ${params.holderId},
            1, now() + (${leaseMs} || ' milliseconds')::interval, now()
        -- A caller that names a generation is claiming a lease it has already
        -- seen. If no row exists there is nothing to fence, so the insert must
        -- not quietly create one at generation 1 and report success.
        WHERE ${expected}::integer IS NULL
           OR EXISTS (
                SELECT 1 FROM "browserControlLease"
                WHERE "browser_run_id" = ${params.browserRunId}::uuid
              )
        ON CONFLICT ("browser_run_id") DO UPDATE
        SET "holder_kind" = EXCLUDED."holder_kind",
            "holder_id" = EXCLUDED."holder_id",
            "generation" = "browserControlLease"."generation" + 1,
            "expires_at" = EXCLUDED."expires_at",
            "updated_at" = now()
        WHERE "browserControlLease"."email" = ${params.userEmail}
          AND (
            ${expected}::integer IS NULL
            OR "browserControlLease"."generation" = ${expected}::integer
          )
        RETURNING "browser_run_id", "holder_kind", "holder_id", "generation", "expires_at"
    `);

    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
        browserRunId: String(row.browser_run_id),
        holderKind: row.holder_kind as HolderKind,
        holderId: row.holder_id as string | null,
        generation: Number(row.generation),
        expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    };
}

/**
 * Takes control away from everyone and bumps the fence.
 *
 * Used before granting the other side, so there is never a moment when both an
 * old holder and a new one would pass authorisation.
 */
export async function revokeControl(params: {
    browserRunId: string;
    userEmail: string;
    expectedGeneration?: number;
}): Promise<number | null> {
    const expected = params.expectedGeneration ?? null;

    const result = await db.execute(sql`
        UPDATE "browserControlLease"
        SET "holder_kind" = 'none', "holder_id" = NULL,
            "generation" = "generation" + 1,
            "expires_at" = NULL, "updated_at" = now()
        WHERE "browser_run_id" = ${params.browserRunId}::uuid
          AND "email" = ${params.userEmail}
          AND (
            ${expected}::integer IS NULL
            OR "generation" = ${expected}::integer
          )
        RETURNING "generation"
    `);

    const row = result.rows?.[0] as { generation?: number } | undefined;
    return row?.generation == null ? null : Number(row.generation);
}

/**
 * The check every input must pass.
 *
 * Owner, run, holder, generation and expiry all come from one snapshot of one
 * row, and expiry is evaluated by the database clock rather than the app's, so
 * a node with a skewed clock cannot accept input on a lease that has run out.
 */
export async function authorizeInput(params: {
    browserRunId: string;
    userEmail: string;
    holderKind: Exclude<HolderKind, "none">;
    holderId: string;
    generation: number;
}): Promise<AuthorizeResult> {
    const result = await db.execute(sql`
        SELECT
            "holder_kind",
            "holder_id",
            "generation",
            ("expires_at" IS NOT NULL AND "expires_at" <= now()) AS "is_expired"
        FROM "browserControlLease"
        WHERE "browser_run_id" = ${params.browserRunId}::uuid
          AND "email" = ${params.userEmail}
    `);

    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return { allowed: false, reason: "no_lease" };

    if (row.holder_kind !== params.holderKind || row.holder_id !== params.holderId) {
        return { allowed: false, reason: "not_holder" };
    }

    const generation = Number(row.generation);
    if (generation !== params.generation) {
        return { allowed: false, reason: "stale_generation" };
    }

    if (row.is_expired === true || row.is_expired === "t") {
        return { allowed: false, reason: "expired" };
    }

    return { allowed: true, generation };
}

/** Extends a lease without changing hands, so the generation does not move. */
export async function renewControl(params: {
    browserRunId: string;
    userEmail: string;
    holderId: string;
    generation: number;
    leaseMs?: number;
}): Promise<boolean> {
    const result = await db.execute(sql`
        UPDATE "browserControlLease"
        SET "expires_at" = now() + (${params.leaseMs ?? DEFAULT_LEASE_MS} || ' milliseconds')::interval,
            "updated_at" = now()
        WHERE "browser_run_id" = ${params.browserRunId}::uuid
          AND "email" = ${params.userEmail}
          AND "holder_id" = ${params.holderId}
          AND "generation" = ${params.generation}
        RETURNING "generation"
    `);

    return Boolean(result.rows?.[0]);
}

/**
 * Hands control to the human.
 *
 * One statement, not a revoke followed by a grant: the increment that fences
 * the agent out and the write that names the human are the same write, so
 * there is no instant in which either both or neither holds control. Pass the
 * generation the caller last saw and two simultaneous takeovers cannot both
 * win, because the second is comparing against a generation that has moved.
 */
export async function takeOver(params: {
    browserRunId: string;
    userEmail: string;
    humanId: string;
    expectedGeneration?: number;
}): Promise<Lease | null> {
    return grantControl({
        browserRunId: params.browserRunId,
        userEmail: params.userEmail,
        holderKind: "human",
        holderId: params.humanId,
        expectedGeneration: params.expectedGeneration,
    });
}

/**
 * Hands control back to the agent.
 *
 * Same single-statement handover in the other direction. The human's
 * generation is superseded by the write that issues the agent's, so a human
 * tab left open in another window cannot type into the browser afterwards.
 */
export async function returnToAgent(params: {
    browserRunId: string;
    userEmail: string;
    agentWorkerId: string;
    expectedGeneration?: number;
}): Promise<Lease | null> {
    return grantControl({
        browserRunId: params.browserRunId,
        userEmail: params.userEmail,
        holderKind: "agent",
        holderId: params.agentWorkerId,
        expectedGeneration: params.expectedGeneration,
    });
}
