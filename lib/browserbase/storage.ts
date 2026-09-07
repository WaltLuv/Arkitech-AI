/**
 * Arkitech-controlled private artifact storage.
 *
 * Bytes live in the database, keyed by artifact id, so a screenshot or a
 * downloaded file outlives the provider session that produced it. Every read
 * is scoped to the owner in the query itself: an artifact id on its own,
 * however it was obtained, returns nothing to anyone but its owner.
 */
import { browserArtifact, browserArtifactBlob, db } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import { checksumOf, recordArtifact } from "./activity";

/** Storage keys are self-describing so a reader knows where to look. */
export const BLOB_STORAGE_PREFIX = "db:blob:";

/**
 * Records an artifact and holds its bytes, in that order, so an artifact row
 * that is `verified` always has bytes behind it.
 *
 * If the blob write fails after the row exists, the row is corrected to
 * `missing` rather than left claiming evidence that is not there.
 */
export async function storeArtifact(params: {
    browserRunId: string;
    userEmail: string;
    agentId?: string | null;
    browserSessionId?: string | null;
    source: "screenshot" | "download" | "generated" | "recording";
    filename?: string | null;
    mimeType?: string | null;
    bytes: Uint8Array;
}) {
    const artifact = await recordArtifact({
        browserRunId: params.browserRunId,
        userEmail: params.userEmail,
        agentId: params.agentId ?? null,
        browserSessionId: params.browserSessionId ?? null,
        source: params.source,
        filename: params.filename ?? null,
        mimeType: params.mimeType ?? null,
        bytes: params.bytes,
        // The key is derived from the id the row will have; recordArtifact only
        // sets `verified` when both a key and bytes are present.
        storageKey: `${BLOB_STORAGE_PREFIX}pending`,
    });

    try {
        await db.insert(browserArtifactBlob).values({
            artifactId: artifact.id,
            userEmail: params.userEmail,
            bytes: Buffer.from(params.bytes),
        });

        await db
            .update(browserArtifact)
            .set({ storageKey: `${BLOB_STORAGE_PREFIX}${artifact.id}` })
            .where(eq(browserArtifact.id, artifact.id));

        return { ...artifact, storageKey: `${BLOB_STORAGE_PREFIX}${artifact.id}` };
    } catch (error) {
        await db
            .update(browserArtifact)
            .set({ verificationState: "missing", storageKey: null })
            .where(eq(browserArtifact.id, artifact.id));
        throw error;
    }
}

export type ReadArtifact = {
    id: string;
    filename: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    checksum: string | null;
    bytes: Buffer;
};

/**
 * Reads an artifact's bytes for its owner, and only its owner.
 *
 * The checksum is recomputed on the way out. Bytes that no longer match the
 * recorded checksum are refused, because serving them as evidence would be
 * a lie about what happened.
 */
export async function readOwnedArtifact(
    artifactId: string,
    userEmail: string,
): Promise<ReadArtifact | null> {
    if (!artifactId || !userEmail) return null;

    const rows = await db
        .select({
            id: browserArtifact.id,
            filename: browserArtifact.filename,
            mimeType: browserArtifact.mimeType,
            sizeBytes: browserArtifact.sizeBytes,
            checksum: browserArtifact.checksum,
            verificationState: browserArtifact.verificationState,
            retentionState: browserArtifact.retentionState,
            bytes: browserArtifactBlob.bytes,
        })
        .from(browserArtifact)
        .innerJoin(
            browserArtifactBlob,
            and(
                eq(browserArtifactBlob.artifactId, browserArtifact.id),
                eq(browserArtifactBlob.userEmail, userEmail),
            ),
        )
        .where(and(eq(browserArtifact.id, artifactId), eq(browserArtifact.userEmail, userEmail)));

    const row = rows[0];
    if (!row) return null;
    if (row.retentionState !== "retained") return null;
    if (row.verificationState !== "verified") return null;

    const bytes = Buffer.from(row.bytes);
    if (row.checksum && checksumOf(bytes) !== row.checksum) return null;

    return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        checksum: row.checksum,
        bytes,
    };
}

/** Bytes held per owner, for the usage view. Never scans another owner's rows. */
export async function storageBytesForOwner(userEmail: string): Promise<number> {
    const result = await db.execute(sql`
        SELECT COALESCE(SUM(octet_length("bytes")), 0) AS total
        FROM "browserArtifactBlob"
        WHERE "email" = ${userEmail}
    `);

    const row = result.rows?.[0] as { total?: string | number } | undefined;
    return Number(row?.total ?? 0);
}
