/**
 * The mediated view: one JPEG of the current tab, captured on the server.
 *
 * This is how Watch works without handing the client a writable capability.
 * The provider's live view URLs can drive the browser and cannot be revoked,
 * so they stay on the server; the client gets pixels, and the page's URL and
 * title in headers, and nothing it could connect to.
 */
import { captureFrame, safeErrorMessage } from "@/lib/browserbase/driver";
import { latestSessionForRun, loadOwnedBrowserRun } from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const LIVE = new Set(["pending", "running"]);

export async function GET(_req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NextResponse.json({ error: "Browser run not found" }, { status: 404 });

    const session = await latestSessionForRun(run.id, userEmail);
    if (!session?.browserbaseSessionId || !LIVE.has(session.status)) {
        return NextResponse.json(
            { error: "No live browser for this run", sessionStatus: session?.status ?? null },
            { status: 409 },
        );
    }

    try {
        const frame = await captureFrame(session.browserbaseSessionId);

        return new NextResponse(new Uint8Array(frame.jpeg), {
            status: 200,
            headers: {
                "Content-Type": "image/jpeg",
                "Cache-Control": "no-store",
                "X-Page-Url": encodeURIComponent(frame.url),
                "X-Page-Title": encodeURIComponent(frame.title),
                "X-Viewport-Width": String(frame.viewport.width),
                "X-Viewport-Height": String(frame.viewport.height),
                "X-Tab-Count": String(frame.tabCount),
            },
        });
    } catch (error) {
        // Redacted whatever threw it; the client sees a state, not a secret.
        return NextResponse.json({ error: safeErrorMessage(error) }, { status: 502 });
    }
}
