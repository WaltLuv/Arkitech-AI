/**
 * Agent Slots: creating an Agent without exceeding the account's entitlement.
 *
 * Paused Agents occupy a slot; deleting one frees it. Execution Mode does not
 * change the cost. The entitlement rules that need no database live in
 * `agent-entitlement.ts`, so the UI can read the numbers without dragging the
 * ORM and the whole schema into the browser bundle.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";
import {
    AGENT_SLOT_PLAN_TIERS,
    DEFAULT_AGENT_SLOT_PLAN_TIER,
    MAX_AGENT_SLOT_ENTITLEMENT,
    PLAN_INCLUDED_AGENT_SLOTS,
    describeAgentSlotEntitlement,
    type AgentSlotEntitlement,
} from "./agent-entitlement";

export {
    AGENT_SLOT_PLAN_TIERS,
    MAX_AGENT_SLOT_ENTITLEMENT,
    PLAN_INCLUDED_AGENT_SLOTS,
    agentSlotLimitMessage,
    describeAgentSlotEntitlement,
    hasAgentSlotAvailable,
    isValidAgentSlotOverride,
    resolveEffectiveAgentSlots,
    type AgentSlotEntitlement,
    type AgentSlotPlanTier,
} from "./agent-entitlement";

/**
 * The plan names are pasted into SQL rather than bound as parameters, because
 * a bound parameter inside a CASE and inside `generate_series` arithmetic
 * leaves PostgreSQL guessing at types. They are compile-time constants from
 * this repo, never user input, and this assertion is what keeps that true: a
 * plan name that is not a bare lowercase word fails on this module's first
 * import rather than reaching a query.
 */
for (const tier of AGENT_SLOT_PLAN_TIERS) {
    if (!/^[a-z]+$/.test(tier)) {
        throw new Error(`Unsafe plan tier name for SQL: ${tier}`);
    }
}

/**
 * The account's effective entitlement, as a SQL expression over `users u`.
 *
 * Built from `PLAN_INCLUDED_AGENT_SLOTS` so the plan numbers exist once, and
 * mirroring `resolveEffectiveAgentSlots`: a valid override wins, otherwise the
 * plan decides, and anything unrecognised resolves to Starter.
 *
 * The bounds are the fail-safe half of the rule. Reads never trust what is
 * stored: an override outside [0, MAX_AGENT_SLOT_ENTITLEMENT] is ignored in
 * favour of the plan, and the whole expression is clamped again, so no stored
 * value can hand `generate_series` an absurd range to enumerate. Writes reject
 * bad values instead of clamping them, so an operator's typo stays visible.
 */
const EFFECTIVE_LIMIT_SQL = `
    LEAST(
        ${MAX_AGENT_SLOT_ENTITLEMENT},
        GREATEST(
            0,
            COALESCE(
                CASE
                    WHEN u."agent_slot_override" IS NOT NULL
                     AND u."agent_slot_override" >= 0
                     AND u."agent_slot_override" <= ${MAX_AGENT_SLOT_ENTITLEMENT}
                    THEN u."agent_slot_override"
                END,
                CASE u."plan_tier"
                    ${AGENT_SLOT_PLAN_TIERS.map(
                        tier => `WHEN '${tier}' THEN ${PLAN_INCLUDED_AGENT_SLOTS[tier]}`,
                    ).join("\n                    ")}
                    ELSE ${PLAN_INCLUDED_AGENT_SLOTS[DEFAULT_AGENT_SLOT_PLAN_TIER]}
                END
            )
        )
    )`;

/** Exposed so a test can assert what the database is actually asked. */
export const effectiveLimitSql = () => EFFECTIVE_LIMIT_SQL;

/**
 * Creates an Agent only if the account has a slot for it.
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
 * a slot index in [0, effective limit), unique per user. The statement claims
 * the lowest free index, and concurrent claimants of the same index collide on
 * the unique index so exactly one wins. Deleting an Agent frees its index.
 *
 * Three separate things happen inside that one statement, and they are worth
 * not confusing with each other:
 *
 *   - The entitlement boundary is the upper bound of the `generate_series`.
 *   - Candidate selection is the lowest free index within it, recomputed from
 *     scratch on every attempt.
 *   - Collision retry is the loop below, which turns only on a unique
 *     violation.
 *
 * The occupancy guard is a fourth, and it exists only because a downgrade
 * breaks the induction the slot index relies on. "Occupied is at most the
 * limit" holds while the limit never shrinks; once an account holds 14 Agents
 * against a limit of 10, deleting the one in slot 5 would leave a free index
 * below the limit and let the account climb back to 14. The guard refuses
 * while occupied is at or above the limit, so it can only ever add a refusal.
 * An account under its limit is still capped structurally by the unique index
 * and not by this count, which is why it is not a return to counting.
 *
 * The entitlement is read inside this statement rather than passed in, so no
 * caller can get a quota argument wrong and no client can inject one, and the
 * entitlement and the claim share a single database snapshot. The guarantee is
 * worth stating exactly: a creation is evaluated against the entitlement
 * visible to its own statement, and once a downgrade is visible to subsequent
 * statements no later creation succeeds while occupied is at or above the new
 * limit. A create whose statement had already begun is not serialised against
 * that downgrade, and neon-http has no transaction that would change it.
 *
 * Returns the created Agent, or null when no slot is available.
 */
export type AgentClaim = {
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
};

/**
 * The claim statement itself, separated so a test can take the real query
 * rather than a transcription of it. A hand-copied statement in a test proves
 * only that the copy works.
 */
export function agentClaimQuery(values: AgentClaim) {
    return sql`
            WITH entitlement AS (
                SELECT ${sql.raw(EFFECTIVE_LIMIT_SQL)} AS effective_limit
                FROM "users" u
                WHERE u."email" = ${values.userEmail}
            )
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
            FROM entitlement e
            CROSS JOIN LATERAL (
                SELECT gs AS slot
                FROM generate_series(0, e.effective_limit - 1) gs
                WHERE NOT EXISTS (
                    SELECT 1 FROM "agentConfig" taken
                    WHERE taken."email" = ${values.userEmail}
                      AND taken."slot_index" = gs
                )
                ORDER BY gs
                LIMIT 1
            ) AS candidate
            WHERE (
                SELECT count(*) FROM "agentConfig" occupied
                WHERE occupied."email" = ${values.userEmail}
            ) < e.effective_limit
            RETURNING *
        `;
}

export async function createAgentWithinEntitlement(
    values: AgentClaim,
): Promise<Record<string, unknown> | null> {
    const claim = async () => {
        const result = await db.execute(agentClaimQuery(values));

        return (result.rows?.[0] as Record<string, unknown> | undefined) ?? null;
    };

    // A loser in a slot collision may still find a different slot free, so it
    // recomputes and tries again. Every iteration past the first means another
    // creator took a distinct slot, and no account has more slots than the
    // ceiling, so the ceiling is a true upper bound rather than a guess. An
    // account with no slot left returns on the first attempt without retrying,
    // because an empty candidate is not an error.
    for (let attempt = 0; attempt < MAX_AGENT_SLOT_ENTITLEMENT; attempt++) {
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

/**
 * What the account is entitled to and what it is using.
 *
 * The one server-owned answer. Routes enforce with it and the UI displays it,
 * so the sidebar cannot advertise a different number from the one creation
 * enforces. An account with no user row is described as Starter with nothing
 * occupied, which is what creation does too: it refuses rather than inventing
 * an entitlement for a row that is not there.
 */
export async function getAgentSlotEntitlement(userEmail: string): Promise<AgentSlotEntitlement> {
    const result = await db.execute(sql`
        SELECT
            u."plan_tier" AS plan_tier,
            u."agent_slot_override" AS agent_slot_override,
            (
                SELECT count(*) FROM "agentConfig" occupied
                WHERE occupied."email" = ${userEmail}
            ) AS occupied_slots
        FROM "users" u
        WHERE u."email" = ${userEmail}
    `);

    const row = result.rows?.[0] as
        | { plan_tier?: unknown; agent_slot_override?: unknown; occupied_slots?: unknown }
        | undefined;

    const override = row?.agent_slot_override;

    return describeAgentSlotEntitlement({
        planTier: row?.plan_tier,
        agentSlotOverride: override === null || override === undefined ? null : Number(override),
        occupiedSlots: Number(row?.occupied_slots ?? 0),
    });
}
