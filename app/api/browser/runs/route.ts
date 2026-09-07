/**
 * Browser runs for the signed-in user: list them, or queue a new one.
 *
 * Queuing writes the run and hands the queue to the worker. It does not open
 * a browser: that happens only when a worker claims the run and holds a slot,
 * so no session is paid for before there is capacity to use it.
 */
import { AgentConfig, browserRun, db } from "@/db";
import { BROWSER_RUN_QUEUED } from "@/inngest/browser-functions";
import { inngest } from "@/inngest/client";
import { loadOwnedAgent } from "@/lib/agent-ownership";
import { recordEventWithRetry } from "@/lib/browserbase/activity";
import { isBrowserbaseConfigured } from "@/lib/browserbase/client";
import { currentUser } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_TASK_LENGTH = 4000;

export async function GET() {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const runs = await db
        .select({
            id: browserRun.id,
            agentId: browserRun.agentId,
            agentName: AgentConfig.name,
            task: browserRun.task,
            status: browserRun.status,
            priority: browserRun.priority,
            queuedAt: browserRun.queuedAt,
            startedAt: browserRun.startedAt,
            endedAt: browserRun.endedAt,
            failureReason: browserRun.failureReason,
        })
        .from(browserRun)
        .leftJoin(AgentConfig, eq(browserRun.agentId, AgentConfig.agentId))
        .where(eq(browserRun.userEmail, userEmail))
        .orderBy(desc(browserRun.queuedAt))
        .limit(100);

    return NextResponse.json({ configured: isBrowserbaseConfigured(), runs });
}

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const body = await req.json().catch(() => null) as { agentId?: unknown; task?: unknown; priority?: unknown } | null;
    const agentId = typeof body?.agentId === "string" ? body.agentId : "";
    const task = typeof body?.task === "string" ? body.task.trim() : "";
    const priority = body?.priority === "urgent" ? "urgent" : "normal";

    if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    if (!task) return NextResponse.json({ error: "task is required" }, { status: 400 });
    if (task.length > MAX_TASK_LENGTH) {
        return NextResponse.json({ error: `task must be at most ${MAX_TASK_LENGTH} characters` }, { status: 400 });
    }

    const ownership = await loadOwnedAgent(agentId, userEmail);
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status });

    if (!isBrowserbaseConfigured()) {
        return NextResponse.json(
            { error: "Browser execution is not configured on this server" },
            { status: 503 },
        );
    }

    const inserted = await db
        .insert(browserRun)
        .values({ userEmail, agentId: ownership.agent.agentId, task, priority, status: "queued" })
        .returning({ id: browserRun.id, status: browserRun.status, queuedAt: browserRun.queuedAt });

    const run = inserted[0];

    await recordEventWithRetry({
        browserRunId: run.id, userEmail, kind: "queued", actor: "human", detail: { priority },
    });

    await inngest.send({ name: BROWSER_RUN_QUEUED, data: { browserRunId: run.id } });

    return NextResponse.json(run, { status: 201 });
}
