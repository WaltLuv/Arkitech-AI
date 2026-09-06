/**
 * API route for manual and chat-triggered agent execution.
 *
 * A Run row is created before the credit is charged, so every Ledger Entry can
 * name the Run and the Agent it belongs to. Chat-style executions create a Run
 * too: they spend a credit, and spend that cannot be attributed to an Agent
 * cannot appear on the usage dashboard.
 */
import { AgentConfig, AgentRun, db } from "@/db";
import { inngest } from "@/inngest/client";
import { chargeRun, creditCostFor, isPaid, refundRun } from "@/lib/credits";
import { executeAgent } from "@/lib/execute-agent";
import { currentUser } from "@clerk/nextjs/server";
import type { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const { agentId, input } = await req.json();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';

    if (!userEmail) {
        return NextResponse.json({ error: 'Unauthorized User' }, { status: 401 })
    }

    if (!agentId) {
        return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    // The Agent is always loaded server-side and checked against the caller.
    // Configuration is never taken from the request body.
    const owned = await db.select().from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)));

    const agentRow = owned[0];

    if (!agentRow) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    // The row is the trusted source. It is widened to the shape the agent
    // runtime expects; the jsonb columns are untyped at the database boundary.
    const AgentConfigData = agentRow as unknown as CreatedAgentType;

    const cost = creditCostFor('standard');
    const now = new Date();

    if (input == null) {

        // Manual dashboard runs are queued through Inngest so long jobs do not
        // block the API request lifecycle.
        const isAgentRunning = await db.select().from(AgentRun)
            .where(and(eq(AgentRun.agentId, AgentConfigData.agentId), inArray(AgentRun.status, ['queued', 'running'])))

        if (isAgentRunning.length != 0) {
            return NextResponse.json({ error: 'Agent already running!' }, { status: 400 })
        }

        const insertAgentRun = await db.insert(AgentRun)
            .values({
                agentId: AgentConfigData.agentId,
                userEmail: userEmail,
                scheduledFor: now,
                timezone: AgentConfigData.schedule?.timezone ?? 'UTC',
                status: 'queued',
                creditCost: cost,
                queuedAt: now
            }).returning();

        const run = insertAgentRun[0];

        // Charged against the Run, so the ledger can attribute the spend.
        const charged = await chargeRun({
            userEmail,
            agentId: AgentConfigData.agentId,
            runId: run.id,
            cost,
        });

        if (!isPaid(charged)) {
            await db.delete(AgentRun).where(eq(AgentRun.id, run.id));
            return NextResponse.json({ error: 'Insufficient credit balance.' }, { status: 402 })
        }

        try {
            await inngest.send({
                name: 'agent/run.execute',
                data: { runId: run.id }
            });
            return NextResponse.json({ msg: 'Agent running' }, { status: 200 })
        }
        catch (e) {
            await refundRun({
                userEmail,
                agentId: AgentConfigData.agentId,
                runId: run.id,
                cost: run.creditCost,
                reason: 'platform_failure',
            });

            await db.update(AgentRun)
                .set({
                    status: 'failed',
                    error: 'Could not queue the run',
                    completedAt: new Date()
                }).where(eq(AgentRun.id, run.id));

            return NextResponse.json({ error: e }, { status: 500 })
        }

    }

    // Chat-style runs execute immediately and still consume one usage credit.
    const chatRunRows = await db.insert(AgentRun)
        .values({
            agentId: AgentConfigData.agentId,
            userEmail: userEmail,
            scheduledFor: now,
            timezone: AgentConfigData.schedule?.timezone ?? 'UTC',
            status: 'running',
            creditCost: cost,
            queuedAt: now,
            startedAt: now,
        }).returning();

    const chatRun = chatRunRows[0];

    const charged = await chargeRun({
        userEmail,
        agentId: AgentConfigData.agentId,
        runId: chatRun.id,
        cost,
    });

    if (!isPaid(charged)) {
        await db.delete(AgentRun).where(eq(AgentRun.id, chatRun.id));
        return NextResponse.json({ error: 'Insufficient credit balance.' }, { status: 402 })
    }

    try {
        const result = await executeAgent({
            agentConfig: AgentConfigData,
            userEmail: userEmail,
            input: input ?? null
        })

        await db.update(AgentRun)
            .set({ status: 'completed', output: result, completedAt: new Date() })
            .where(eq(AgentRun.id, chatRun.id));

        return NextResponse.json(result);
    } catch (e) {
        // The agent failed, not the user. A credit buys a result.
        await refundRun({
            userEmail,
            agentId: AgentConfigData.agentId,
            runId: chatRun.id,
            cost: chatRun.creditCost,
            reason: 'agent_failure',
        });

        await db.update(AgentRun)
            .set({
                status: 'failed',
                error: e instanceof Error ? e.message : 'Agent run failed',
                completedAt: new Date()
            })
            .where(eq(AgentRun.id, chatRun.id));

        return NextResponse.json({ error: 'Agent run failed' }, { status: 500 })
    }
}
