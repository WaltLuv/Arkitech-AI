import { beforeEach, describe, expect, it, vi } from "vitest";

const composioTools = [{ name: "GMAIL_SEND" }, { name: "SLACK_POST" }];
const tools = vi.fn(async () => composioTools);
const getOrCreateAgentSession = vi.fn(async () => ({ tools }));

vi.mock("@/lib/get-agent-composio-session", () => ({
    get getOrCreateAgentSession() {
        return getOrCreateAgentSession;
    },
}));

vi.mock("@/lib/browserbase-tool", () => ({
    browserbaseResearchTool: { name: "browser_research" },
}));

// Capture what the Agents SDK is constructed with instead of building a real one.
const agentConstructor = vi.fn();
vi.mock("@openai/agents", () => ({
    Agent: class {
        constructor(config: unknown) {
            agentConstructor(config);
            Object.assign(this as object, config as object);
        }
    },
}));

import { buildAgent } from "@/lib/build-agent";

const agentConfig = (overrides: Record<string, unknown> = {}) =>
    ({
        name: "researcher",
        description: "researches things",
        instructions: "be thorough",
        objective: "find the best price",
        skills: ["search", "compare"],
        ...overrides,
    }) as never;

const configPassedToAgent = () => agentConstructor.mock.calls[0][0];

describe("buildAgent", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
    });

    it("names the agent after its config", async () => {
        await buildAgent(agentConfig(), "someone@example.com");

        expect(configPassedToAgent().name).toBe("researcher");
    });

    it("takes the model from the environment", async () => {
        vi.stubEnv("OPENAI_MODEL", "gpt-5-mini");

        await buildAgent(agentConfig(), "someone@example.com");

        expect(configPassedToAgent().model).toBe("gpt-5-mini");
    });

    it("folds every persisted field into the system instruction", async () => {
        await buildAgent(agentConfig(), "someone@example.com");

        const { instructions } = configPassedToAgent();

        expect(instructions).toContain("researches things");
        expect(instructions).toContain("be thorough");
        expect(instructions).toContain("find the best price");
        expect(instructions).toContain("search, compare");
    });

    it("keeps the read-only browsing rules in the instruction", async () => {
        // These rules are the only thing stopping the browser tool from being
        // used to log in, buy things, or submit forms. Losing them is a
        // security regression, not a copy change.
        await buildAgent(agentConfig(), "someone@example.com");

        const { instructions } = configPassedToAgent();

        expect(instructions).toContain("Browser research is read-only.");
        expect(instructions).toMatch(/Never use it to purchase, log in, submit forms/);
    });

    it("survives an agent saved without any skills", async () => {
        await buildAgent(agentConfig({ skills: undefined }), "someone@example.com");

        expect(configPassedToAgent().instructions).toContain("Skills:");
    });

    it("gives the agent its Composio tools plus browser research", async () => {
        await buildAgent(agentConfig(), "someone@example.com");

        expect(configPassedToAgent().tools).toEqual([
            { name: "GMAIL_SEND" },
            { name: "SLACK_POST" },
            { name: "browser_research" },
        ]);
    });

    it("scopes the Composio session to the calling user", async () => {
        const config = agentConfig();

        await buildAgent(config, "someone@example.com");

        expect(getOrCreateAgentSession).toHaveBeenCalledWith(
            config,
            "someone@example.com",
        );
    });
});
