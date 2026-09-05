import { beforeEach, describe, expect, it, vi } from "vitest";

// Both dependencies reach the network in production, so they are mocked here.
// The alias form proves "@/*" resolves in mock factories as well as imports.
vi.mock("@/lib/build-agent", () => ({
    buildAgent: vi.fn(async () => ({ name: "stub-agent" })),
}));

vi.mock("@openai/agents", () => ({
    run: vi.fn(async () => ({ finalOutput: "done" })),
}));

import { buildAgent } from "@/lib/build-agent";
import { executeAgent } from "@/lib/execute-agent";
import { run } from "@openai/agents";

// Only the fields executeAgent actually reads. Cast because the real type is
// owned by a React component module we do not want to load in a node test.
const agentConfig = (overrides: Record<string, unknown> = {}) =>
    ({
        name: "researcher",
        status: "active",
        objective: "saved objective",
        ...overrides,
    }) as never;

describe("executeAgent", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses to run an agent that is not active", async () => {
        await expect(
            executeAgent({
                agentConfig: agentConfig({ status: "paused" }),
                userEmail: "someone@example.com",
                input: "hello",
            }),
        ).rejects.toThrow("Agent is not active!");

        expect(buildAgent).not.toHaveBeenCalled();
    });

    it("accepts a status in any casing", async () => {
        await expect(
            executeAgent({
                agentConfig: agentConfig({ status: "Active" }),
                userEmail: "someone@example.com",
                input: "hello",
            }),
        ).resolves.toEqual({ finalOutput: "done" });
    });

    it("passes trimmed user input through to the run", async () => {
        await executeAgent({
            agentConfig: agentConfig(),
            userEmail: "someone@example.com",
            input: "  look something up  ",
        });

        expect(run).toHaveBeenCalledWith(
            { name: "stub-agent" },
            "look something up",
        );
    });

    it("falls back to the saved objective when input is blank", async () => {
        // Scheduled and manual runs arrive with no chat message.
        await executeAgent({
            agentConfig: agentConfig(),
            userEmail: "someone@example.com",
            input: "   ",
        });

        expect(run).toHaveBeenCalledWith(
            { name: "stub-agent" },
            "saved objective",
        );
    });
});
