/**
 * One conversational turn: create the Run, charge for it, execute the Agent,
 * and settle the Run either way.
 *
 * This was the body of the chat branch in app/api/agent/run/route.ts. It moved
 * here so a message arriving from Telegram or Slack runs through exactly the
 * same path as one typed into Arkitech: the same Run row, the same Usage
 * Credit, the same refund on failure, the same Agent runtime. A channel that
 * built its own execution path would drift from this one, and the first thing
 * to drift would be the charging.
 *
 * Deliberately knows nothing about channels. Callers persist their own
 * messages around it.
 */
import { AgentConfig, AgentRun, db } from "@/db";
import { chargeRun, creditCostFor, isPaid, refundRun } from "@/lib/credits";
import { executeAgent } from "@/lib/execute-agent";
import type { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { and, eq } from "drizzle-orm";

export type AgentTurnResult =
    | { outcome: "completed"; runId: string; output: string }
    | { outcome: "agent_not_found" }
    | { outcome: "insufficient_credit" }
    | { outcome: "failed"; runId: string; error: string };

/**
 * Load an Agent the caller actually owns.
 *
 * Ownership is checked here rather than trusted from the caller, because the
 * channel pipeline resolves an Agent from an inbound provider payload and must
 * never be able to reach another account's Agent by id.
 */
export async function loadOwnedAgent(
    agentId: string,
    userEmail: string,
): Promise<CreatedAgentType | null> {
    const owned = await db
        .select()
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)));

    return (owned[0] as unknown as CreatedAgentType) ?? null;
}

export async function runAgentTurn({
    agentConfig,
    userEmail,
    input,
}: {
    agentConfig: CreatedAgentType;
    userEmail: string;
    input: string;
}): Promise<AgentTurnResult> {
    const cost = creditCostFor("standard");
    const now = new Date();

    const runRows = await db
        .insert(AgentRun)
        .values({
            agentId: agentConfig.agentId,
            userEmail,
            scheduledFor: now,
            timezone: agentConfig.schedule?.timezone ?? "UTC",
            status: "running",
            creditCost: cost,
            queuedAt: now,
            startedAt: now,
        })
        .returning();

    const run = runRows[0];

    const charged = await chargeRun({
        userEmail,
        agentId: agentConfig.agentId,
        runId: run.id,
        cost,
    });

    if (!isPaid(charged)) {
        await db.delete(AgentRun).where(eq(AgentRun.id, run.id));
        return { outcome: "insufficient_credit" };
    }

    try {
        const result = await executeAgent({ agentConfig, userEmail, input });

        await db
            .update(AgentRun)
            .set({ status: "completed", output: result, completedAt: new Date() })
            .where(eq(AgentRun.id, run.id));

        return {
            outcome: "completed",
            runId: run.id,
            output: typeof result?.finalOutput === "string" ? result.finalOutput : "",
        };
    } catch (e) {
        // The agent failed, not the user. A credit buys a result.
        await refundRun({
            userEmail,
            agentId: agentConfig.agentId,
            runId: run.id,
            cost: run.creditCost,
            reason: "agent_failure",
        });

        const error = e instanceof Error ? e.message : "Agent run failed";

        await db
            .update(AgentRun)
            .set({ status: "failed", error, completedAt: new Date() })
            .where(eq(AgentRun.id, run.id));

        return { outcome: "failed", runId: run.id, error };
    }
}
