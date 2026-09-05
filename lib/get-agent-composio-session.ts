/**
 * Composio session helper that reuses or creates agent-specific toolkit sessions.
 */
import { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { composio } from "./composio";
import { AgentConfig, db } from "@/db";
import { eq } from "drizzle-orm";

export async function getOrCreateAgentSession(agentConfig: CreatedAgentType, userEmail: string) {

    // Persisted session IDs let edits/runs reuse toolkit authorization state.
    if (agentConfig?.composioSessionId) {
        return composio.use(agentConfig?.composioSessionId)
    }

    // Attach any already-authorized accounts that match the agent's selected toolkits.
    const connectedAccounts = await getActiveConnectedAccounts(userEmail, agentConfig.tools);
    const session = await composio.sessions.create(userEmail, {
        toolkits: agentConfig.tools,
        connectedAccounts
    })

    // Save the session ID so future runs and edits target the same Composio session.
    await SaveComposioSessionId(agentConfig?.agentId, session)

    return session

}

export const getActiveConnectedAccounts = async (userEmail: string, toolSlugs: string[]) => {
    const accounts = await composio.connectedAccounts.list({
        userIds: [userEmail],
        toolkitSlugs: toolSlugs,
        statuses: ['ACTIVE']
    })

    // Composio expects connected account IDs grouped by toolkit slug.
    return accounts.items.reduce((acc: Record<string, string[]>, account: any) => {
        const slug = account?.toolkit?.slug?.toLowerCase();
        if (slug && !acc[slug]) {
            acc[slug] = [account.id];
        }
        return acc;
    }, {})
}

const SaveComposioSessionId = async (agentId: string, session: any) => {
    const result = await db.update(AgentConfig).set({
        composioSessionId: session.sessionId
    }).where(eq(AgentConfig.agentId, agentId));
    console.log(result);
}
