/**
 * API route for manual and chat-triggered agent execution, including credit checks and queueing.
 */
import { AgentConfig, AgentRun, db } from "@/db";
import { inngest } from "@/inngest/client";
import { deductUsageCredit, refundUsageCredit } from "@/lib/credits";
import { executeAgent } from "@/lib/execute-agent";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const { agentConfig, agentId, input } = await req.json();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';

    if (!userEmail) {
        return NextResponse.json({ error: 'Unauthorized User' }, { status: 401 })
    }

    let AgentConfigData = agentConfig;

    if (!AgentConfigData) {
        const result = await db.select().from(AgentConfig)
            .where(eq(AgentConfig.agentId, agentId));

        AgentConfigData = result[0];
    }

    if (input == null) {

        // Manual dashboard runs are queued through Inngest so long jobs do not
        // block the API request lifecycle.
        const isAgentRunning = await db.select().from(AgentRun)
            .where(and(eq(AgentRun.agentId, AgentConfigData?.agentId), inArray(AgentRun.status, ['queued', 'running'])))

        if (isAgentRunning.length != 0) {
            return NextResponse.json({ error: 'Agent already running!' }, { status: 400 })
        }

        // Deduct before queueing. If the event cannot be sent, the catch block refunds it.
        const creditBalance = await deductUsageCredit(userEmail);

        if (!creditBalance) {
            return NextResponse.json({ error: 'Insufficient credit balance.' }, { status: 402 })
        }

        const now = new Date();
        const insertAgentRun = await db.insert(AgentRun)
            .values({
                agentId: AgentConfigData?.agentId,
                userEmail: userEmail,
                scheduledFor: now,
                timezone: AgentConfigData?.schedule?.timezone,
                status: 'queued',
                queuedAt: now
            }).returning();

        const run = insertAgentRun[0];

        try {
            await inngest.send({
                name: 'agent/run.execute',
                data: { runId: run.id }
            });
            return NextResponse.json({ msg: 'Agent running' }, { status: 200 })
        }
        catch (e) {
            await refundUsageCredit(userEmail);

            await db.update(AgentRun)
                .set({
                    status: 'failed',
                    error: 'Error',
                    completedAt: new Date()
                }).where(eq(AgentRun.id, run.id));

            return NextResponse.json({ error: e }, { status: 500 })
        }

    }

    // Chat-style runs execute immediately and still consume one usage credit.
    const creditBalance = await deductUsageCredit(userEmail);

    if (!creditBalance) {
        return NextResponse.json({ error: 'Insufficient credit balance.' }, { status: 402 })
    }

    const result = await executeAgent({
        agentConfig: AgentConfigData,
        userEmail: userEmail,
        input: input ?? null
    })

    return NextResponse.json(result);
}
