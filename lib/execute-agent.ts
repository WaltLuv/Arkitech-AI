/**
 * Agent execution wrapper that validates status and returns the final OpenAI Agents output.
 */
import { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { buildAgent } from "./build-agent";
import { run } from "@openai/agents";

export async function executeAgent({
    agentConfig,
    userEmail,
    input,
}: {
    agentConfig: CreatedAgentType,
    userEmail: string,
    input: string
}) {

    if (agentConfig.status.toLowerCase() !== 'active') {
        throw new Error('Agent is not active!')
    }

    // Build the runtime agent lazily so tool connections are fresh for each run.
    const agent = await buildAgent(agentConfig, userEmail);

    // Chat messages provide input; scheduled/manual runs fall back to the saved objective.
    const result = await run(agent, input?.trim() || agentConfig?.objective)

    return {
        finalOutput: result?.finalOutput
    }
}
