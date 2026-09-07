/**
 * Watch: everything the operator needs to know about one run, and nothing
 * that would let them drive it. No provider URL of any kind is in this
 * response; the frame and input routes mediate the browser.
 */
import { AgentConfig, db } from "@/db";
import { currentController, latestSessionForRun, loadOwnedBrowserRun, queuePosition } from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NextResponse.json({ error: "Browser run not found" }, { status: 404 });

    const [agentRows, session, controller, position, lastSeen] = await Promise.all([
        db.select({ name: AgentConfig.name }).from(AgentConfig).where(eq(AgentConfig.agentId, run.agentId)),
        latestSessionForRun(run.id, userEmail),
        currentController(run.id, userEmail),
        queuePosition(run),
        // The last place the browser was seen, from the activity trail.
        db.execute(sql`
            SELECT "detail"->>'url' AS url, "detail"->>'title' AS title
            FROM "browserEvent"
            WHERE "browser_run_id" = ${run.id}::uuid AND "email" = ${userEmail}
              AND "kind" IN ('navigation', 'screenshot')
            ORDER BY "sequence" DESC LIMIT 1
        `),
    ]);

    const site = (lastSeen.rows?.[0] ?? null) as { url?: string; title?: string } | null;

    return NextResponse.json({
        id: run.id,
        agentId: run.agentId,
        agentName: agentRows[0]?.name ?? null,
        task: run.task,
        status: run.status,
        priority: run.priority,
        attempt: run.attempt,
        queuedAt: run.queuedAt,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        cancelRequested: run.cancelRequestedAt !== null,
        failureReason: run.failureReason,
        result: run.result,
        queuePosition: position,
        controller,
        session: session
            ? { status: session.status, releaseState: session.releaseState, createdAt: session.createdAt, releasedAt: session.releasedAt }
            : null,
        site: site?.url ? { url: site.url, title: site.title ?? "" } : null,
    });
}
