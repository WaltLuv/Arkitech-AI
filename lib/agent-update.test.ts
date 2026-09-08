import { describe, expect, it } from "vitest";
import {
    EDITABLE_AGENT_FIELDS,
    SERVER_OWNED_AGENT_FIELDS,
    pickAgentUpdate,
} from "@/lib/agent-update";

/**
 * What the dashboard actually sends. Both callers spread the Agent they read
 * back from the API, so a real request already carries every server-owned
 * column. The allowlist is what makes that harmless.
 */
const agentFromTheApi = {
    id: 7,
    agentId: "agent-1",
    userEmail: "owner@example.com",
    slotIndex: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    composioSessionId: "session-1",
    name: "Axe",
    description: "Portfolio manager",
    instructions: "Watch the book",
    objective: "Beat the benchmark",
    tools: ["markets"],
    skills: ["risk"],
    schedule: { type: "recurring", frequency: "daily", time: "09:00" },
    outputFormat: "text",
    status: "active",
    agentImage: "https://example.com/axe.svg",
};

describe("What a user may change about their Agent", () => {
    it("keeps every field the editor is for", () => {
        const update = pickAgentUpdate(agentFromTheApi);

        for (const field of EDITABLE_AGENT_FIELDS) {
            expect(update).toHaveProperty(field);
        }
        expect(update.name).toBe("Axe");
        expect(update.status).toBe("active");
    });

    it("drops every server-owned field from a normal dashboard request", () => {
        const update = pickAgentUpdate(agentFromTheApi) as Record<string, unknown>;

        for (const field of SERVER_OWNED_AGENT_FIELDS) {
            expect(update).not.toHaveProperty(field);
        }
    });
});

describe("Agent Slot allocation is not a client's to set", () => {
    it("refuses to move an Agent to another slot", () => {
        // The bypass: moving your own Agent out to a high slot frees a low
        // index, and the freed index is a slot the account can create into.
        const update = pickAgentUpdate({ ...agentFromTheApi, slotIndex: 99 }) as Record<string, unknown>;

        expect(update).not.toHaveProperty("slotIndex");
    });

    it("refuses an out-of-range slot index just as flatly", () => {
        for (const slotIndex of [-1, 0, 3, 25, 100, 10_000, "4", null]) {
            const update = pickAgentUpdate({ ...agentFromTheApi, slotIndex }) as Record<string, unknown>;
            expect(update).not.toHaveProperty("slotIndex");
        }
    });

    it("refuses to reassign the Agent to another account", () => {
        const update = pickAgentUpdate({
            ...agentFromTheApi,
            userEmail: "attacker@example.com",
        }) as Record<string, unknown>;

        expect(update).not.toHaveProperty("userEmail");
    });

    it("refuses to change identity or rewrite when it was created", () => {
        const update = pickAgentUpdate({
            ...agentFromTheApi,
            id: 999,
            agentId: "someone-elses-agent",
            createdAt: "1999-01-01T00:00:00.000Z",
        }) as Record<string, unknown>;

        expect(update).not.toHaveProperty("id");
        expect(update).not.toHaveProperty("agentId");
        expect(update).not.toHaveProperty("createdAt");
    });

    it("refuses to rebind the Agent to another credential session", () => {
        const update = pickAgentUpdate({
            ...agentFromTheApi,
            composioSessionId: "someone-elses-session",
        }) as Record<string, unknown>;

        expect(update).not.toHaveProperty("composioSessionId");
    });
});

describe("Allocation and account state are not Agent fields", () => {
    it("ignores quota and credit fields named on an Agent update", () => {
        // How many Agent Slots an account gets, and what it has spent, are the
        // server's to decide. Naming one on an Agent update writes nothing,
        // whether or not it is a column.
        const update = pickAgentUpdate({
            ...agentFromTheApi,
            quota: 100,
            effectiveLimit: 100,
            agentCredits: 100,
            usageCredits: 100,
        }) as Record<string, unknown>;

        expect(update).not.toHaveProperty("quota");
        expect(update).not.toHaveProperty("effectiveLimit");
        expect(update).not.toHaveProperty("agentCredits");
        expect(update).not.toHaveProperty("usageCredits");
    });

    it("keeps nothing at all from a payload of only unknown fields", () => {
        expect(pickAgentUpdate({ nonsense: 1, __proto__: { polluted: true } })).toEqual({});
    });

    it("survives a body that is not an object", () => {
        expect(pickAgentUpdate(null)).toEqual({});
        expect(pickAgentUpdate("agent")).toEqual({});
        expect(pickAgentUpdate(undefined)).toEqual({});
    });

    it("drops an undefined value rather than blanking the column", () => {
        const update = pickAgentUpdate({ name: undefined, description: null });

        expect(update).not.toHaveProperty("name");
        expect(update.description).toBeNull();
    });
});
