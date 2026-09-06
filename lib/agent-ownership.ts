/**
 * Agent ownership checks.
 *
 * Every agent-scoped route resolves its Agent through here. Looking one up by
 * `agentId` alone is what let any signed-in user act on another user's Agent,
 * so the id is never sufficient on its own: the row must also belong to the
 * caller.
 */
import { AgentConfig, db } from "@/db";
import { and, eq } from "drizzle-orm";

export type OwnedAgent = typeof AgentConfig.$inferSelect;

/**
 * A missing Agent and someone else's Agent are deliberately indistinguishable.
 * Returning 403 for one and 404 for the other tells an attacker which ids
 * exist, so both resolve to "not found".
 */
export type OwnershipFailure = { ok: false; status: 404; error: string };
export type OwnershipSuccess = { ok: true; agent: OwnedAgent };
export type OwnershipResult = OwnershipSuccess | OwnershipFailure;

export const AGENT_NOT_FOUND: OwnershipFailure = {
    ok: false,
    status: 404,
    error: "Agent not found",
};

/** Decides the outcome. Pure, so the rule is testable without a database. */
export function resolveOwnership(
    agent: OwnedAgent | undefined,
    userEmail: string,
): OwnershipResult {
    if (!userEmail) return AGENT_NOT_FOUND;
    if (!agent) return AGENT_NOT_FOUND;
    if (agent.userEmail !== userEmail) return AGENT_NOT_FOUND;
    return { ok: true, agent };
}

/**
 * Loads an Agent only if it belongs to the caller. The ownership predicate is
 * in the query, so a row that is not the caller's never leaves the database.
 */
export async function loadOwnedAgent(
    agentId: string | null | undefined,
    userEmail: string,
): Promise<OwnershipResult> {
    if (!agentId || !userEmail) return AGENT_NOT_FOUND;

    const rows = await db
        .select()
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)));

    return resolveOwnership(rows[0], userEmail);
}
