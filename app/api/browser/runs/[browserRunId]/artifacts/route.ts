/**
 * Files for one run: metadata only. Bytes come from the artifact route,
 * which checks ownership again on its own.
 */
import { browserArtifact, db } from "@/db";
import { loadOwnedBrowserRun } from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NextResponse.json({ error: "Browser run not found" }, { status: 404 });

    const artifacts = await db
        .select({
            id: browserArtifact.id,
            source: browserArtifact.source,
            filename: browserArtifact.filename,
            mimeType: browserArtifact.mimeType,
            sizeBytes: browserArtifact.sizeBytes,
            checksum: browserArtifact.checksum,
            verificationState: browserArtifact.verificationState,
            retentionState: browserArtifact.retentionState,
            createdAt: browserArtifact.createdAt,
        })
        .from(browserArtifact)
        .where(and(eq(browserArtifact.browserRunId, run.id), eq(browserArtifact.userEmail, userEmail)))
        .orderBy(desc(browserArtifact.createdAt))
        .limit(500);

    return NextResponse.json({ artifacts });
}
