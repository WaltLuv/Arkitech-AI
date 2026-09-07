/**
 * The bytes of one artifact, for its owner. The read is owner-scoped in the
 * query and the checksum is re-verified on the way out, so a guessed id
 * yields nothing and a corrupted blob is never served as evidence.
 */
import { readOwnedArtifact } from "@/lib/browserbase/storage";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only types a browser can render inline safely; everything else downloads. */
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"]);

export async function GET(_req: NextRequest, context: { params: Promise<{ artifactId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { artifactId } = await context.params;
    if (!UUID.test(artifactId)) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

    const artifact = await readOwnedArtifact(artifactId, userEmail);
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

    const mimeType = artifact.mimeType && INLINE_TYPES.has(artifact.mimeType)
        ? artifact.mimeType
        : "application/octet-stream";
    const disposition = INLINE_TYPES.has(mimeType) ? "inline" : "attachment";
    const filename = (artifact.filename ?? artifact.id).replace(/["\r\n]/g, "");

    return new NextResponse(new Uint8Array(artifact.bytes), {
        status: 200,
        headers: {
            "Content-Type": mimeType,
            "Content-Length": String(artifact.bytes.byteLength),
            "Content-Disposition": `${disposition}; filename="${filename}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            ...(artifact.checksum ? { "X-Checksum-Sha256": artifact.checksum } : {}),
        },
    });
}
