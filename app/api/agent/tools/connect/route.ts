/**
 * API route that starts or removes Composio toolkit connections for a specific agent.
 */
import { AgentConfig, db } from "@/db";
import { composio } from "@/lib/composio";
import { getActiveConnectedAccounts, getOrCreateAgentSession } from "@/lib/get-agent-composio-session";
import { loadOwnedAgent } from "@/lib/agent-ownership";
import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    const { toolSlug, agentId } = await req.json();
    const user = await currentUser();
    const ownership = await loadOwnedAgent(agentId, user?.primaryEmailAddress?.emailAddress ?? '');
    if (!ownership.ok) {
        return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    if (!user) {
        return NextResponse.json({ 'error': 'Unauthorized User' }, { status: 400 })
    }

    // Reuse the row ownership already resolved, rather than re-reading it
    // unscoped.
    //@ts-ignore
    const session = await getOrCreateAgentSession(ownership.agent, user?.primaryEmailAddress?.emailAddress)
    const connectedAccounts = await getActiveConnectedAccounts(user?.primaryEmailAddress?.emailAddress ?? '', [toolSlug]);

    // Reuse an existing active account when the user has already connected this toolkit.
    if (connectedAccounts[toolSlug.toLowerCase()]) {
        await session.update({ connectedAccounts });
        return NextResponse.json({ connected: true })
    }

    // Otherwise Composio creates the hosted OAuth/link flow and returns its redirect URL.
    const connectionRequest = await session.authorize(toolSlug);

    return NextResponse.json({
        redirectUrl: connectionRequest.redirectUrl
    })
}

export async function DELETE(req: NextRequest) {
    const { toolSlug, agentId } = await req.json();

    // This handler previously had no authentication: any caller could
    // disconnect a tool from any Agent by id.
    const user = await currentUser();
    const ownership = await loadOwnedAgent(agentId, user?.primaryEmailAddress?.emailAddress ?? '');
    if (!ownership.ok) {
        return NextResponse.json({ error: ownership.error }, { status: ownership.status })
    }

    const compositonSessionId = ownership.agent.composioSessionId;

    const session = await composio.use(compositonSessionId ?? '')

    const toolKits = await session.toolkits();


    const toolKit = toolKits.items.find((item: any) => item.slug.toLowerCase() === toolSlug.toLowerCase());

    // Delete the account connected to this agent session, not every account for the user.
    const sessionConnectedAccountId = toolKit?.connection?.connectedAccount?.id ?? null;

    if (!sessionConnectedAccountId) {
        return NextResponse.json({ error: 'Connection Not Found' }, { status: 404 })
    }

    await composio.connectedAccounts.delete(sessionConnectedAccountId);

    return NextResponse.json({ success: true })

}
