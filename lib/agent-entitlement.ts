/**
 * Agent Slot entitlement, as pure rules.
 *
 * How many Agent Slots an account is entitled to, and nothing that reaches the
 * database. Separate from `agent-slots.ts` for the same reason the old quota
 * constant was: the sidebar needs the numbers, and importing the database
 * module from a client component pulls the ORM and the whole schema into the
 * browser bundle.
 *
 * This is the only definition of the plan numbers. The SQL that claims a slot
 * builds its CASE expression from `PLAN_INCLUDED_AGENT_SLOTS` rather than
 * repeating them, so the server cannot enforce a number the UI does not show.
 *
 * An Agent Slot is not a Usage Credit, and neither is Browserbase capacity. A
 * Business account may employ 25 Agents while Arkitech still runs them through
 * one browser slot and a much smaller concurrent-run pool.
 */

/** The plans an account can be on. */
export const AGENT_SLOT_PLAN_TIERS = ["starter", "pro", "business", "enterprise"] as const;

export type AgentSlotPlanTier = (typeof AGENT_SLOT_PLAN_TIERS)[number];

/**
 * Agent Slots included with each plan.
 *
 * Enterprise is configured per account through an override. Without one it
 * gets the Business allotment rather than an invented larger number, so a
 * misconfigured Enterprise account is under-served rather than unbounded.
 */
export const PLAN_INCLUDED_AGENT_SLOTS: Record<AgentSlotPlanTier, number> = {
    starter: 3,
    pro: 10,
    business: 25,
    enterprise: 25,
};

/** What an account with no plan recorded is treated as. */
export const DEFAULT_AGENT_SLOT_PLAN_TIER: AgentSlotPlanTier = "starter";

/**
 * The largest Agent Slot entitlement any account may be configured with.
 *
 * A safety ceiling, not a price. It bounds what an operator can type and what
 * `generate_series` can ever be handed, so a malformed override cannot ask
 * PostgreSQL to enumerate a billion candidate slots.
 *
 * `drizzle/0012_agent_slot_entitlement.sql` repeats this number in a CHECK
 * constraint, and `agent-entitlement.sql.test.ts` fails if the two disagree.
 */
export const MAX_AGENT_SLOT_ENTITLEMENT = 100;

/** True when `value` is one of the plans, so a legacy null is not one. */
export function isAgentSlotPlanTier(value: unknown): value is AgentSlotPlanTier {
    return typeof value === "string" && (AGENT_SLOT_PLAN_TIERS as readonly string[]).includes(value);
}

/**
 * True when `value` is an override an operator is allowed to store.
 *
 * Zero is deliberately valid: it freezes an account at its current Agents
 * without deleting any of them. Anything non-integer, negative, or above the
 * ceiling is not, and privileged writes reject it rather than clamping, so an
 * operator typo is visible instead of silently becoming a different number.
 */
export function isValidAgentSlotOverride(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= MAX_AGENT_SLOT_ENTITLEMENT
    );
}

/** The plan a stored value means, treating anything unrecognised as Starter. */
export function resolveAgentSlotPlanTier(planTier: unknown): AgentSlotPlanTier {
    return isAgentSlotPlanTier(planTier) ? planTier : DEFAULT_AGENT_SLOT_PLAN_TIER;
}

/**
 * The Agent Slots an account may occupy.
 *
 * This is the read path, so it fails safe rather than rejecting: a plan it
 * does not recognise resolves to Starter, and an override that is not storable
 * is ignored in favour of the plan. Writes are validated separately, by
 * `isValidAgentSlotOverride`, because a bad value that reached the database
 * should not be able to widen an entitlement afterwards.
 */
export function resolveEffectiveAgentSlots(account: {
    planTier?: unknown;
    agentSlotOverride?: unknown;
}): number {
    if (isValidAgentSlotOverride(account.agentSlotOverride)) {
        return account.agentSlotOverride;
    }

    return PLAN_INCLUDED_AGENT_SLOTS[resolveAgentSlotPlanTier(account.planTier)];
}

/** What the account is entitled to and what it is currently using. */
export type AgentSlotEntitlement = {
    planTier: AgentSlotPlanTier;
    includedSlots: number;
    override: number | null;
    effectiveLimit: number;
    occupiedSlots: number;
    availableSlots: number;
    isAtLimit: boolean;
    isOverEntitlement: boolean;
};

/**
 * Describes an account's Agent Slot position from stored values.
 *
 * `availableSlots` is never negative. An account left over entitlement by a
 * downgrade reports what is true, 14 occupied against a limit of 10, with no
 * slots available, rather than minus four of them.
 */
export function describeAgentSlotEntitlement(account: {
    planTier?: unknown;
    agentSlotOverride?: unknown;
    occupiedSlots: number;
}): AgentSlotEntitlement {
    const planTier = resolveAgentSlotPlanTier(account.planTier);
    const effectiveLimit = resolveEffectiveAgentSlots(account);
    const occupiedSlots = Math.max(0, account.occupiedSlots);

    return {
        planTier,
        includedSlots: PLAN_INCLUDED_AGENT_SLOTS[planTier],
        override: isValidAgentSlotOverride(account.agentSlotOverride) ? account.agentSlotOverride : null,
        effectiveLimit,
        occupiedSlots,
        availableSlots: Math.max(0, effectiveLimit - occupiedSlots),
        isAtLimit: occupiedSlots >= effectiveLimit,
        isOverEntitlement: occupiedSlots > effectiveLimit,
    };
}

/** True when the account may create another Agent. */
export function hasAgentSlotAvailable(occupiedSlots: number, effectiveLimit: number): boolean {
    return occupiedSlots < effectiveLimit;
}

/**
 * The message shown when no slot is available.
 *
 * An account left over entitlement by a downgrade is told its Agents are safe,
 * because the alternative reads like data loss.
 */
export function agentSlotLimitMessage(entitlement: {
    effectiveLimit: number;
    occupiedSlots: number;
}): string {
    if (entitlement.occupiedSlots > entitlement.effectiveLimit) {
        return (
            `You have ${entitlement.occupiedSlots} Agents on a ${entitlement.effectiveLimit}-slot plan. ` +
            `Your existing Agents keep working. Creating another is unavailable until you free enough slots or your limit increases.`
        );
    }

    return `Agent limit reached. You can have ${entitlement.effectiveLimit} Agents. Delete one to free a slot.`;
}
