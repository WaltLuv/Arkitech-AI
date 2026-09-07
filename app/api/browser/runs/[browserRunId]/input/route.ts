/**
 * Human input, mediated. The only way a person's click reaches the browser.
 *
 * Order of checks, all on the server: the caller owns the run; the caller's
 * channel holds the human lease under exactly this generation and the lease
 * has not expired; the action is well-formed and inside the rendered frame.
 * A frontend can be rewritten freely and still cannot skip any of them.
 */
import { recordEventWithRetry } from "@/lib/browserbase/activity";
import { currentViewport, dispatchAction, safeErrorMessage } from "@/lib/browserbase/driver";
import { mapClientAction, type ClientAction, type RenderedBox } from "@/lib/browserbase/input-mapping";
import { authorizeHumanInput, latestSessionForRun, loadOwnedBrowserRun } from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type InputBody = {
    channelId?: unknown;
    generation?: unknown;
    action?: unknown;
    rendered?: unknown;
};

/** What goes in the trail. Coordinates and kinds, never typed content. */
function safeDetail(action: ReturnType<typeof mapClientAction> extends infer R ? R extends { ok: true; action: infer A } ? A : never : never) {
    switch (action.type) {
        case "text": return { type: "text", length: action.text.length };
        case "key": return { type: "key", combination: action.combination };
        case "drag": return { type: "drag", points: action.path.length };
        default: return { ...action };
    }
}

export async function POST(req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NextResponse.json({ error: "Browser run not found" }, { status: 404 });

    const body = await req.json().catch(() => null) as InputBody | null;
    const channelId = typeof body?.channelId === "string" ? body.channelId : "";
    const generation = Number.isInteger(body?.generation) ? (body!.generation as number) : NaN;
    const rendered = body?.rendered as RenderedBox | undefined;

    if (!channelId || Number.isNaN(generation)) {
        return NextResponse.json({ error: "channelId and generation are required" }, { status: 400 });
    }

    // Authorisation before validation: a caller without control learns
    // nothing about what a valid action would look like.
    const authorised = await authorizeHumanInput({ browserRunId: run.id, userEmail, channelId, generation });
    if (!authorised.allowed) {
        return NextResponse.json({ error: "Not in control", reason: authorised.reason }, { status: 403 });
    }

    const session = await latestSessionForRun(run.id, userEmail);
    if (!session?.browserbaseSessionId || !["pending", "running"].includes(session.status)) {
        return NextResponse.json({ error: "No live browser for this run" }, { status: 409 });
    }

    let viewport;
    try {
        viewport = await currentViewport(session.browserbaseSessionId);
    } catch (error) {
        return NextResponse.json({ error: safeErrorMessage(error) }, { status: 502 });
    }
    if (!viewport) return NextResponse.json({ error: "Browser viewport unknown" }, { status: 502 });

    const mapped = mapClientAction(body?.action as ClientAction, rendered ?? viewport, viewport);
    if (!mapped.ok) return NextResponse.json({ error: mapped.reason }, { status: 400 });

    try {
        await dispatchAction(session.browserbaseSessionId, mapped.action);
    } catch (error) {
        // Redacted here as well as in the driver: whatever threw, no
        // websocket URL or key reaches a response body.
        return NextResponse.json({ error: safeErrorMessage(error) }, { status: 502 });
    }

    await recordEventWithRetry({
        browserRunId: run.id,
        userEmail,
        browserSessionId: session.id,
        kind: "action_executed",
        actor: "human",
        actorId: channelId,
        detail: { ...safeDetail(mapped.action), generation },
    });

    return NextResponse.json({ ok: true, generation: authorised.generation });
}
