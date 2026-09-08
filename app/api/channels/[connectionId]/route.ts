/**
 * Managing one connection: change which Team member answers, or disconnect.
 *
 * Both are owner-scoped through loadOwnedConnection, so a connection id
 * belonging to another account is a 404 here rather than an action.
 */
import { AgentConfig, channelConnection, db } from "@/db";
import { disconnectConnection, loadOwnedConnection } from "@/lib/channels/connections";
import { toConnectionView } from "@/lib/channels/connection-view";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const { connectionId } = await context.params;
    const { agentId } = (await req.json().catch(() => ({}))) as { agentId?: string };

    if (!agentId) {
        return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    const connection = await loadOwnedConnection(connectionId, userEmail);

    if (!connection) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const owned = await db
        .select({ agentId: AgentConfig.agentId })
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)))
        .limit(1);

    if (!owned[0]) {
        return NextResponse.json({ error: "That team member was not found." }, { status: 404 });
    }

    const updated = await db
        .update(channelConnection)
        .set({ defaultAgentId: agentId, updatedAt: new Date() })
        .where(eq(channelConnection.id, connection.id))
        .returning();

    // Existing conversations keep the Team member they were held with. Moving
    // a finished exchange to a different Agent would rewrite who said what.
    return NextResponse.json(toConnectionView(updated[0]));
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const { connectionId } = await context.params;
    const connection = await loadOwnedConnection(connectionId, userEmail);

    if (!connection) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await disconnectConnection(connection);

    return NextResponse.json({ ok: true });
}
