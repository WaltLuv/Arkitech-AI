/**
 * What a user is allowed to change about their own Agent.
 *
 * The update route used to spread the request body straight into the UPDATE.
 * Ownership was checked, so the Agent was yours, but every column was writable
 * on it, including `slotIndex`. Sending `{ agentId: "<yours>", slotIndex: 99 }`
 * moved the Agent out to slot 99, freed a low index, and let the account
 * create another Agent: a quota bypass through a field the product never meant
 * to expose. Allocation state is the server's, not the client's.
 *
 * An allowlist rather than a denylist, because the failure mode of a denylist
 * is that every column added later is writable until somebody remembers.
 */
import type { AgentConfig } from "@/db";

/** The Agent fields a user may edit. Everything else is server-owned. */
export const EDITABLE_AGENT_FIELDS = [
    "name",
    "description",
    "instructions",
    "objective",
    "tools",
    "skills",
    "schedule",
    "outputFormat",
    "status",
    "agentImage",
] as const;

export type EditableAgentField = (typeof EDITABLE_AGENT_FIELDS)[number];

/**
 * Fields a request may name that the server owns outright.
 *
 * Listed for the test that proves each one survives an update attempt, not
 * used to filter: `pickAgentUpdate` keeps only what is allowed, so a column
 * added to the schema tomorrow is unwritable without being named here.
 *
 *   - `id`, `agentId`   identity, and what ownership was checked against
 *   - `userEmail`       who owns it
 *   - `slotIndex`       Agent Slot allocation, the quota bypass above
 *   - `createdAt`       when it was made
 *   - `composioSessionId` binds the Agent to credentials it executes with
 */
export const SERVER_OWNED_AGENT_FIELDS = [
    "id",
    "agentId",
    "userEmail",
    "slotIndex",
    "createdAt",
    "composioSessionId",
] as const;

/**
 * The subset of a request body that may be written to an Agent.
 *
 * Undefined values are dropped so a partial edit does not blank a column the
 * client simply did not send. An explicit null is kept, because clearing a
 * description is a real edit.
 */
export type AgentUpdate = Partial<Pick<typeof AgentConfig.$inferInsert, EditableAgentField>>;

export function pickAgentUpdate(payload: unknown): AgentUpdate {
    if (typeof payload !== "object" || payload === null) return {};

    const source = payload as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    for (const field of EDITABLE_AGENT_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
            update[field] = source[field];
        }
    }

    return update as AgentUpdate;
}
