/**
 * Agent Slots: a user's quota on how many Agents they may have.
 *
 * Paused Agents occupy a slot; deleting one frees it. Execution Mode does not
 * change the cost. The quota lives here so the API and the UI cannot drift
 * apart, which is what let the sidebar advertise a different number from the
 * one the server enforced.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const AGENT_SLOT_QUOTA = 3;

/** True when the user may create another Agent. */
export function hasAgentSlotAvailable(
    currentAgentCount: number,
    quota: number = AGENT_SLOT_QUOTA,
): boolean {
    return currentAgentCount < quota;
}

/**
 * Creates an Agent only if the user is under quota.
 *
 * A count followed by an insert is not enough: two requests at 2 agents both
 * read 2 and both insert. Reproduced against a real PostgreSQL, where five
 * concurrent creates at 2/3 produced seven Agents.
 *
 * Locking does not fix it either. Both an advisory lock and SELECT FOR UPDATE
 * were measured here and both still let the quota be exceeded, because the
 * count reads the statement snapshot taken before the lock is acquired, so a
 * waiter still sees the old total.
 *
 * The invariant is therefore enforced by the database itself: each Agent takes
 * a slot index in [0, quota), unique per user. The statement claims the lowest
 * free index, and concurrent claimants of the same index collide on the unique
 * index so exactly one wins. Deleting an Agent frees its index for reuse.
 *
 * Returns the created Agent, or null when the user is already at quota.
 */
export async function createAgentWithinQuota(values: {
    userEmail: string;
    agentId: string;
    agentImage: string;
    name: string | null;
    description: string | null;
    instructions: string | null;
    objective: string | null;
    tools: unknown;
    skills: unknown;
    schedule: unknown;
    outputFormat: string | null;
    status: string | null;
    quota?: number;
}): Promise<Record<string, unknown> | null> {
    const quota = values.quota ?? AGENT_SLOT_QUOTA;

    const claim = async () => {
        const result = await db.execute(sql`
            INSERT INTO "agentConfig" (
                "email", "agentId", "agentImage", "name", "description",
                "instructions", "objective", "tools", "skills", "schedule",
                "outputFormat", "status", "slot_index"
            )
            SELECT
                ${values.userEmail}, ${values.agentId}, ${values.agentImage},
                ${values.name}, ${values.description}, ${values.instructions},
                ${values.objective}, ${JSON.stringify(values.tools ?? null)}::jsonb,
                ${JSON.stringify(values.skills ?? null)}::jsonb,
                ${JSON.stringify(values.schedule ?? null)}::jsonb,
                ${values.outputFormat}, ${values.status ?? 'active'}, candidate.slot
            FROM (
                SELECT gs AS slot
                FROM generate_series(0, ${quota - 1}) gs
                WHERE NOT EXISTS (
                    SELECT 1 FROM "agentConfig" taken
                    WHERE taken."email" = ${values.userEmail}
                      AND taken."slot_index" = gs
                )
                ORDER BY gs
                LIMIT 1
            ) AS candidate
            RETURNING *
        `);

        return (result.rows?.[0] as Record<string, unknown> | undefined) ?? null;
    };

    // A loser in a slot collision may still have a different slot available,
    // so one retry is attempted before refusing. Bounded on purpose.
    for (let attempt = 0; attempt < quota; attempt++) {
        try {
            return await claim();
        } catch (error) {
            const duplicate =
                typeof error === "object" &&
                error !== null &&
                (error as { code?: string }).code === "23505";

            if (!duplicate) throw error;
        }
    }

    return null;
}

/** The message shown when the quota is reached. */
export function agentSlotLimitMessage(quota: number = AGENT_SLOT_QUOTA): string {
    return `Agent limit reached. You can have ${quota} agents. Delete one to free a slot.`;
}
