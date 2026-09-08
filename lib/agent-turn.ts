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


/**
 * Create the Run for this turn.
 *
 * A Run is unique on its Agent and its scheduled time, which is what stops a
 * scheduled Occurrence being enqueued twice. Conversational turns take that
 * time from the clock, so two messages to one Team member inside the same
 * millisecond collide on it. That is rare, and until now the loser of the race
 * threw and the person's message went unanswered with nothing to show for it.
 *
 * Now the timestamp is nudged forward and tried again. The Run is the same Run
 * either way: nothing about ordering, charging or history depends on those
 * milliseconds, only the index does.
 */
async function openRun({
    agentConfig,
    userEmail,
    cost,
}: {
    agentConfig: CreatedAgentType;
    userEmail: string;
    cost: number;
}) {
    let attempt = 0;

    for (;;) {
        const at = new Date(Date.now() + attempt);

        try {
            const rows = await db
                .insert(AgentRun)
                .values({
                    agentId: agentConfig.agentId,
                    userEmail,
                    scheduledFor: at,
                    timezone: agentConfig.schedule?.timezone ?? "UTC",
                    status: "running",
                    creditCost: cost,
                    queuedAt: at,
                    startedAt: at,
                })
                .returning();

            return rows[0];
        } catch (e) {
            // 23505 is the occurrence index. Anything else is a real failure.
            if ((e as { code?: string })?.code !== "23505" || attempt >= 5) {
                throw e;
            }

            attempt += 1;
        }
    }
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

    const run = await openRun({ agentConfig, userEmail, cost });

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
