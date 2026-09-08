/**
 * Client-safe view of an Agent Slot entitlement.
 *
 * `agent-entitlement.ts` is already free of the database, but it also holds
 * the rules the server enforces with. The sidebar needs only the shape it is
 * handed and a name to print, so it imports this and computes nothing: the
 * numbers on screen are the numbers the server sent.
 */
export type { AgentSlotEntitlement, AgentSlotPlanTier } from "./agent-entitlement";

import type { AgentSlotPlanTier } from "./agent-entitlement";

/** How each plan is named to a person. Arkitech hires Agents, it has no quota console. */
export const PLAN_LABELS: Record<AgentSlotPlanTier, string> = {
    starter: "Starter",
    pro: "Pro",
    business: "Business",
    enterprise: "Enterprise",
};
