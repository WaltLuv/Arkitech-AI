import { describe, expect, it } from "vitest";
import { OpenAIAgentsProvider } from "@composio/openai-agents";
import { Agent } from "@openai/agents";

/**
 * Guards the decision recorded in `.npmrc`.
 *
 * Every published version of @composio/openai-agents declares a peer of
 * @openai/agents@^0.1.3, while this project runs 0.17.x. We install with
 * legacy-peer-deps because the constraint is stale metadata: the provider
 * imports only `tool` from the SDK. If a future upgrade ever breaks that
 * assumption, this test fails instead of production.
 */
describe("Composio and OpenAI Agents interop", () => {
    const provider = new OpenAIAgentsProvider();

    const wrap = () =>
        provider.wrapTool(
            {
                slug: "TEST_TOOL",
                description: "a test tool",
                inputParameters: {
                    type: "object",
                    properties: { q: { type: "string" } },
                    required: ["q"],
                },
            } as never,
            (async () => ({ data: { ok: true }, successful: true })) as never,
        );

    it("wraps a Composio tool into something the installed SDK understands", () => {
        expect(wrap()).toBeDefined();
    });

    it("produces a tool the installed Agent constructor accepts", () => {
        const agent = new Agent({
            name: "interop-check",
            instructions: "unused",
            tools: [wrap() as never],
        });

        expect(agent.tools).toHaveLength(1);
    });
});
