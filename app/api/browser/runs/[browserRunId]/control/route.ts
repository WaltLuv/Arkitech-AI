/**
 * Pause, resume, take control, return to agent, stop.
 *
 * Every verb is owner-scoped and conditional on the generation the caller
 * last saw where that matters, so two people pressing buttons at once get
 * one success and one honest 409, never two controllers.
 */
import {
    pauseAgent,
    resumeAgent,
    returnToAgentControl,
    stopRun,
    takeControl,
} from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const ACTIONS = new Set(["pause", "resume", "take", "return", "stop"]);

export async function POST(req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const body = await req.json().catch(() => null) as { action?: unknown; expectedGeneration?: unknown } | null;
    const action = typeof body?.action === "string" ? body.action : "";
    const expectedGeneration = Number.isInteger(body?.expectedGeneration)
        ? (body!.expectedGeneration as number)
        : undefined;

    if (!ACTIONS.has(action)) {
        return NextResponse.json({ error: "action must be pause, resume, take, return or stop" }, { status: 400 });
    }

    const outcome =
        action === "pause" ? await pauseAgent(browserRunId, userEmail) :
        action === "resume" ? await resumeAgent(browserRunId, userEmail) :
        action === "take" ? await takeControl(browserRunId, userEmail, expectedGeneration) :
        action === "return" ? await returnToAgentControl(browserRunId, userEmail, expectedGeneration) :
        await stopRun(browserRunId, userEmail);

    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

    return NextResponse.json({
        ok: true,
        generation: outcome.generation,
        ...(outcome.channelId ? { channelId: outcome.channelId, expiresAt: outcome.expiresAt ?? null } : {}),
    });
}
