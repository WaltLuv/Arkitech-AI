/**
 * The Agent Slot quota, as pure rules.
 *
 * Separate from `agent-slots.ts` because that module reaches the database,
 * and the sidebar needs only the number. Importing the database module from a
 * client component pulls the ORM and the whole schema into the browser bundle
 * for the sake of one constant.
 *
 * Both the API and the UI read the quota from here, so the sidebar can never
 * advertise a different number from the one the server enforces.
 */

export const AGENT_SLOT_QUOTA = 3;

/** True when the user may create another Agent. */
export function hasAgentSlotAvailable(
    currentAgentCount: number,
    quota: number = AGENT_SLOT_QUOTA,
): boolean {
    return currentAgentCount < quota;
}

/** The message shown when the quota is reached. */
export function agentSlotLimitMessage(quota: number = AGENT_SLOT_QUOTA): string {
    return `Agent limit reached. You can have ${quota} agents. Delete one to free a slot.`;
}
