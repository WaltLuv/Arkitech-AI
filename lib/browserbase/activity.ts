/**
 * Browser activity and evidence.
 *
 * The redaction rule is enforced here rather than left to callers. Every event
 * detail is screened before it is written, and anything resembling a
 * credential, a cookie, or a writable browser capability is refused outright.
 * A guard that callers can forget is not a guard.
 */
import { browserArtifact, browserEvent, db } from "@/db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

export type EventKind =
    | "queued" | "claimed" | "started" | "session_created" | "navigation"
    | "action_proposed" | "action_executed" | "approval_requested"
    | "approval_resolved" | "screenshot" | "file_downloaded" | "file_uploaded"
    | "paused" | "takeover_requested" | "human_control" | "agent_control_restored"
    | "warning" | "failed" | "cancelled" | "verification" | "completed"
    | "session_released";

export type Actor = "agent" | "human" | "system";

/** Keys that must never appear in an event detail, whatever their value. */
const FORBIDDEN_KEYS = [
    "password", "passwd", "secret", "token", "apikey", "api_key",
    "cookie", "cookies", "authorization", "auth", "credential", "credentials",
    "debuggerurl", "debuggerfullscreenurl", "wsurl", "cdpurl", "connecturl",
    "sessionurl", "livewurl", "liveviewurl", "reasoning", "chainofthought",
    "thought", "thinking",
];

/** Value shapes that carry control of a browser or an identity. */
const FORBIDDEN_VALUE_PATTERNS = [
    /wss?:\/\//i,                    // websocket, including CDP
    /devtools\/(browser|page)\//i,   // devtools endpoints
    /\bbb_(live|test)_[A-Za-z0-9]/,  // Browserbase-style key
    /\bsk-[A-Za-z0-9]{8,}/,          // provider secret key
    /signature=|X-Amz-Signature|token=/i, // signed capability URLs
];

export class UnsafeActivityDetailError extends Error {
    constructor(reason: string) {
        super(`Refusing to record browser activity: ${reason}`);
        this.name = "UnsafeActivityDetailError";
    }
}

/**
 * Throws rather than silently stripping.
 *
 * Silently dropping a forbidden field would leave the caller believing it was
 * recorded, and the next reader believing the trail is complete.
 */
export function assertSafeDetail(detail: unknown, path = "detail"): void {
    if (detail === null || detail === undefined) return;

    if (typeof detail === "string") {
        for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
            if (pattern.test(detail)) {
                throw new UnsafeActivityDetailError(`${path} matches ${pattern}`);
            }
        }
        return;
    }

    if (Array.isArray(detail)) {
        detail.forEach((item, i) => assertSafeDetail(item, `${path}[${i}]`));
        return;
    }

    if (typeof detail === "object") {
        for (const [key, value] of Object.entries(detail)) {
            const normalised = key.toLowerCase().replace(/[^a-z]/g, "");
            if (FORBIDDEN_KEYS.includes(normalised)) {
                throw new UnsafeActivityDetailError(`${path}.${key} is a forbidden key`);
            }
            assertSafeDetail(value, `${path}.${key}`);
        }
    }
}

/**
 * Appends an event, taking the next sequence number for the run inside the same
 * statement. Two concurrent writers cannot take the same position: the unique
 * index on (run, sequence) rejects the loser.
 */
export async function recordEvent(params: {
    browserRunId: string;
    userEmail: string;
    browserSessionId?: string | null;
    kind: EventKind;
    actor: Actor;
    actorId?: string | null;
    detail?: Record<string, unknown>;
}): Promise<{ sequence: number } | null> {
    assertSafeDetail(params.detail);

    const result = await db.execute(sql`
        INSERT INTO "browserEvent" (
            "browser_run_id", "email", "browser_session_id", "sequence",
            "kind", "actor", "actor_id", "detail"
        )
        SELECT
            ${params.browserRunId}::uuid, ${params.userEmail},
            ${params.browserSessionId ?? null}::uuid,
            COALESCE(
                (SELECT MAX("sequence") FROM "browserEvent"
                 WHERE "browser_run_id" = ${params.browserRunId}::uuid),
                0
            ) + 1,
            ${params.kind}, ${params.actor}, ${params.actorId ?? null},
            ${JSON.stringify(params.detail ?? {})}::jsonb
        RETURNING "sequence"
    `);

    const row = result.rows?.[0] as { sequence?: number } | undefined;
    return row?.sequence == null ? null : { sequence: Number(row.sequence) };
}

/** Retries once on a sequence collision, which is a lost race, not an error. */
export async function recordEventWithRetry(
    params: Parameters<typeof recordEvent>[0],
    attempts = 3,
): Promise<{ sequence: number } | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await recordEvent(params);
        } catch (error) {
            const duplicate = (error as { code?: string }).code === "23505";
            if (!duplicate) throw error;
        }
    }
    return null;
}

export function checksumOf(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Records an artifact whose bytes Arkitech actually holds.
 *
 * `verified` requires a checksum and a storage key. An artifact that only has a
 * provider URL is recorded as `pending`, never as evidence, because a pointer
 * into someone else's storage can disappear.
 */
export async function recordArtifact(params: {
    browserRunId: string;
    userEmail: string;
    agentId?: string | null;
    browserSessionId?: string | null;
    source: "screenshot" | "download" | "generated" | "recording";
    filename?: string | null;
    mimeType?: string | null;
    bytes?: Uint8Array;
    storageKey?: string | null;
}) {
    const stored = Boolean(params.bytes && params.storageKey);

    const inserted = await db
        .insert(browserArtifact)
        .values({
            browserRunId: params.browserRunId,
            userEmail: params.userEmail,
            agentId: params.agentId ?? null,
            browserSessionId: params.browserSessionId ?? null,
            source: params.source,
            filename: params.filename ?? null,
            mimeType: params.mimeType ?? null,
            sizeBytes: params.bytes ? params.bytes.byteLength : null,
            checksum: params.bytes ? checksumOf(params.bytes) : null,
            storageKey: params.storageKey ?? null,
            verificationState: stored ? "verified" : "pending",
        })
        .returning();

    return inserted[0];
}

/**
 * Marks evidence that could not be retrieved.
 *
 * Reported as missing rather than quietly omitted, so a gap in the record is
 * visible instead of looking like nothing happened.
 */
export async function markArtifactMissing(artifactId: string) {
    await db.execute(sql`
        UPDATE "browserArtifact" SET "verification_state" = 'missing'
        WHERE "id" = ${artifactId}::uuid
    `);
}
