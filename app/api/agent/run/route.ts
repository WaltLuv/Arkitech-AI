/**
 * API route for manual and chat-triggered agent execution.
 *
 * A Run row is created before the credit is charged, so every Ledger Entry can
 * name the Run and the Agent it belongs to. Chat-style executions create a Run
 * too: they spend a credit, and spend that cannot be attributed to an Agent
 * cannot appear on the usage dashboard.
 *
 * The chat branch persists its transcript. It used to take the whole history
 * from the request body, which meant history only existed in a browser tab and
 * a client could present any past it liked. Arkitech stores it now, so the same
 * conversation is there after a refresh, and so a Team member reached from
 * Telegram or Slack is working from the same record.
 */
import { AgentConfig, AgentRun, db } from "@/db";
import { inngest } from "@/inngest/client";
import { chargeRun, creditCostFor, isPaid, refundRun } from "@/lib/credits";
import { runAgentTurn } from "@/lib/agent-turn";
import {
    buildAgentInput,
    getOrCreateWebConversation,
    loadConversationMessages,
    recordMessage,
} from "@/lib/channels/conversations";
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
    const message = typeof input === 'string' ? input.trim() : '';

    if (!message) {
        return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    const thread = await getOrCreateWebConversation({
        userEmail,
        agentId: AgentConfigData.agentId,
    });

    const inboundMessage = await recordMessage({
        conversationId: thread.id,
        userEmail,
        direction: 'inbound',
        senderKind: 'user',
        body: message,
        status: 'received',
    });

    // History comes from Arkitech's store, including the message just written,
    // rather than from whatever the client claimed was said before.
    const history = await loadConversationMessages({
        conversationId: thread.id,
        userEmail,
    });

    const turn = await runAgentTurn({
        agentConfig: AgentConfigData,
        userEmail,
        input: buildAgentInput(history),
    });

    if (turn.outcome === 'insufficient_credit') {
        return NextResponse.json({ error: 'Insufficient credit balance.' }, { status: 402 })
    }

    if (turn.outcome === 'agent_not_found') {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (turn.outcome === 'failed') {
        return NextResponse.json({ error: 'Agent run failed' }, { status: 500 })
    }

    await recordMessage({
        conversationId: thread.id,
        userEmail,
        direction: 'outbound',
        senderKind: 'agent',
        body: turn.output,
        // Web replies are delivered by this response, so they are sent the
        // moment they are written. Nothing else has to carry them.
        status: 'sent',
        runId: turn.runId,
        replyToId: inboundMessage.id,
    });

    return NextResponse.json({ finalOutput: turn.output, conversationId: thread.id });
}
