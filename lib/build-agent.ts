/**
 * Factory that creates an OpenAI Agent with Composio tools, browser research, and agent-specific instructions.
 */
import { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { getOrCreateAgentSession } from "./get-agent-composio-session";
import { Agent } from "@openai/agents";
import { browserbaseResearchTool } from "./browserbase-tool";

export async function buildAgent(agentConfig: CreatedAgentType,
    userEmail: string
) {
    // Each agent gets its own Composio session so toolkit access follows its config.
    const session = await getOrCreateAgentSession(agentConfig, userEmail);
    const composioTools = await session.tools();

    // Compose persisted agent details into one system instruction for the Agents SDK.
    const instructions = `
    Role: ${agentConfig?.description},

    Instructions:
    ${agentConfig.instructions},

    Primary Objective
    ${agentConfig.objective},

    Skills:
    ${(agentConfig.skills ?? []).join(', ')}
    
    Browser Research Rules:
- Use browser_research when the user explicitly asks to search or browse the internet.
- Use browser_research for current prices, availability, comparisons, news, and other live facts.
- Do not claim that pricing is current unless browser_research verified it.
- Include the source URLs returned by browser_research in the final answer.
- Clearly distinguish verified facts from conclusions or recommendations.
- Browser research is read-only. Never use it to purchase, log in, submit forms,
  upload files, download files, or modify external systems.


    Use only the available tools when needed.
    Do not claim that an action succeeded unless the tool result confirms it.
    Ask for confirmation before destructive or high-risk actions.
    `.trim()
        ;

    return new Agent({
        name: agentConfig.name,
        model: process.env.OPENAI_MODEL,
        instructions,
        tools: [...composioTools, browserbaseResearchTool]
    })
}
