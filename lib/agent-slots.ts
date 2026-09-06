/**
 * Agent Slots: a user's quota on how many Agents they may have.
 *
 * Paused Agents occupy a slot; deleting one frees it. Execution Mode does not
 * change the cost. The quota lives here so the API and the UI cannot drift
 * apart, which is what let the sidebar advertise a different number from the
 * one the server enforced.
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
