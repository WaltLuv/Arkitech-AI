/**
 * Site policy as stored, and the guard built from it for a live session.
 *
 * Reads and writes are owner-scoped in the query. The guard a run gets is
 * built from the owner's row and nothing else; what it sees while enforcing
 * is written to the activity trail as evidence, and a file the browser
 * downloads is copied into Arkitech's own storage so it outlives the session.
 */
import { browserSitePolicy, db } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { lookup } from "node:dns/promises";
import { markArtifactMissing, recordArtifact, recordEventWithRetry } from "./activity";
import * as driver from "./driver";
import { SiteGuard, type GuardDownload } from "./site-guard";
import { DEFAULT_SITE_POLICY, parseSitePolicy, type SitePolicy } from "./site-policy";
import { storeArtifact } from "./storage";

/** Files larger than this are recorded as missing rather than held. */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** The owner's policy for an Agent, or the default when none is stored. */
export async function loadSitePolicy(agentId: string, userEmail: string): Promise<SitePolicy> {
    const rows = await db
        .select({ allowPublic: browserSitePolicy.allowPublic, allowedHosts: browserSitePolicy.allowedHosts })
        .from(browserSitePolicy)
        .where(and(eq(browserSitePolicy.agentId, agentId), eq(browserSitePolicy.userEmail, userEmail)));

    const row = rows[0];
    if (!row) return DEFAULT_SITE_POLICY;

    // Re-validated on the way out: a row edited by hand still cannot allow
    // a reserved host, because the parser refuses it.
    const parsed = parseSitePolicy({ allowPublic: row.allowPublic, allowedHosts: row.allowedHosts ?? [] });
    return parsed.ok ? parsed.policy : { allowPublic: row.allowPublic, allowedHosts: [] };
}

/**
 * Stores a validated policy for an Agent the caller owns. The upsert's
 * conflict branch is conditioned on the owner, so a row belonging to someone
 * else is never overwritten: the statement simply matches nothing.
 */
export async function saveSitePolicy(agentId: string, userEmail: string, policy: SitePolicy): Promise<boolean> {
    const result = await db.execute(sql`
        INSERT INTO "browserSitePolicy" ("agent_id", "email", "allow_public", "allowed_hosts", "updated_at")
        VALUES (${agentId}, ${userEmail}, ${policy.allowPublic}, ${JSON.stringify(policy.allowedHosts)}::jsonb, now())
        ON CONFLICT ("agent_id") DO UPDATE
        SET "allow_public" = EXCLUDED."allow_public",
            "allowed_hosts" = EXCLUDED."allowed_hosts",
            "updated_at" = now()
        WHERE "browserSitePolicy"."email" = ${userEmail}
        RETURNING "agent_id"
    `);

    return Boolean(result.rows?.[0]);
}

/** Resolves a host from this server, so a rebinding name is caught early. */
export async function resolveHost(host: string): Promise<string[]> {
    const records = await lookup(host, { all: true, verbatim: true });
    return records.map(record => record.address);
}

export type GuardTarget = {
    browserRunId: string;
    userEmail: string;
    agentId: string;
    sessionRecordId: string | null;
    /**
     * Whether this guard records what it blocks and captures what is
     * downloaded. Normally true: `ensureSessionGuard` installs a guard only
     * when the process has none, so a silent one would leave the trail empty
     * for exactly the connections nothing else is watching.
     */
    report: boolean;
};

/** Builds the guard for a run from its owner's stored policy. */
export async function buildGuardForRun(target: GuardTarget): Promise<SiteGuard> {
    const policy = await loadSitePolicy(target.agentId, target.userEmail);
    const base = { browserRunId: target.browserRunId, userEmail: target.userEmail, browserSessionId: target.sessionRecordId };

    return new SiteGuard(policy, {
        resolve: resolveHost,
        report: target.report,
        events: {
            onBlocked: info => {
                void recordEventWithRetry({
                    ...base, kind: "warning", actor: "system",
                    detail: {
                        reason: "site_policy_blocked",
                        cause: info.reason,
                        host: info.host,
                        stage: info.stage,
                        redirected: info.redirected,
                        popup: info.popup,
                    },
                }).catch(() => undefined);
            },
            onNavigated: info => {
                void recordEventWithRetry({
                    ...base, kind: "navigation", actor: "system",
                    detail: { url: info.url, popup: info.popup },
                }).catch(() => undefined);
            },
            onDownload: download => {
                void captureDownload(target, download).catch(() => undefined);
            },
        },
    });
}

/** Reads a stream up to a cap. Returns null when the cap is exceeded. */
export async function readStreamCapped(stream: NodeJS.ReadableStream, cap: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        total += buffer.byteLength;
        if (total > cap) return null;
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

/**
 * Copies a downloaded file into Arkitech storage and records it. If the
 * bytes cannot be read, the artifact is recorded as missing rather than as
 * a pointer to the provider: the trail says a file existed and that we do
 * not hold it, which is the truth.
 */
export async function captureDownload(target: GuardTarget, download: GuardDownload): Promise<void> {
    const filename = safeFilename(download.suggestedFilename());
    const base = { browserRunId: target.browserRunId, userEmail: target.userEmail, browserSessionId: target.sessionRecordId };

    let bytes: Buffer | null = null;
    let failure: string | null = null;
    try {
        bytes = await readStreamCapped(await download.createReadStream(), MAX_DOWNLOAD_BYTES);
        if (!bytes) failure = "too_large";
    } catch {
        failure = "unreadable";
    }

    if (bytes) {
        const artifact = await storeArtifact({
            ...base, agentId: target.agentId, source: "download", filename, mimeType: null, bytes,
        }).catch(() => null);

        await recordEventWithRetry({
            ...base, kind: "file_downloaded", actor: "agent",
            detail: { artifactId: artifact?.id ?? null, filename, sizeBytes: bytes.byteLength, held: Boolean(artifact) },
        });
        return;
    }

    const artifact = await recordArtifact({ ...base, agentId: target.agentId, source: "download", filename }).catch(() => null);
    if (artifact) await markArtifactMissing(artifact.id).catch(() => undefined);

    await recordEventWithRetry({
        ...base, kind: "file_downloaded", actor: "agent",
        detail: { artifactId: artifact?.id ?? null, filename, held: false, reason: failure },
    });
}

/** A name safe to store and to echo: no path separators, no control characters. */
export function safeFilename(name: string): string {
    const cleaned = (name || "download")
        .replace(/[\\/]/g, "_")
        .replace(/[\x00-\x1f\x7f"]/g, "")
        .trim()
        .slice(0, 200);
    return cleaned.length > 0 ? cleaned : "download";
}

/**
 * Makes sure the driver has a guard for this session before anything
 * connects. The worker registers a reporting guard when it opens the
 * session; an operator route, which may run in another process, registers
 * a silent one so its connection enforces the same policy.
 */
export async function ensureSessionGuard(browserbaseSessionId: string, target: GuardTarget): Promise<void> {
    if (driver.hasSessionGuard(browserbaseSessionId)) return;
    driver.registerSessionGuard(browserbaseSessionId, await buildGuardForRun(target));
}
