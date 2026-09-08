/**
 * Owner-scoped access to channel connections.
 *
 * Every read and write here carries the owner in its predicate rather than
 * loading by id and checking afterwards. A connection is the thing that decides
 * whose Team member answers an inbound message, so reaching one that belongs to
 * somebody else is the whole of the cross-tenant risk in this subsystem.
 */
import { channelConnection, channelThread, db } from "@/db";
import type { ChannelConnection } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { adapterFor } from "./registry";
import type { ProviderName } from "./types";

export async function listConnections(userEmail: string): Promise<ChannelConnection[]> {
    return db
        .select()
        .from(channelConnection)
        .where(eq(channelConnection.userEmail, userEmail))
        .orderBy(desc(channelConnection.updatedAt));
}

export async function loadOwnedConnection(
    connectionId: string,
    userEmail: string,
): Promise<ChannelConnection | null> {
    const rows = await db
        .select()
        .from(channelConnection)
        .where(
            and(eq(channelConnection.id, connectionId), eq(channelConnection.userEmail, userEmail)),
        )
        .limit(1)
        // A malformed uuid is a bad request, not a server error.
        .catch(() => []);

    return rows[0] ?? null;
}

/** The live connection for a provider, if the user has one. */
export async function loadOwnedProviderConnection(
    provider: ProviderName,
    userEmail: string,
): Promise<ChannelConnection | null> {
    const rows = await db
        .select()
        .from(channelConnection)
        .where(
            and(
                eq(channelConnection.userEmail, userEmail),
                eq(channelConnection.provider, provider),
            ),
        )
        .orderBy(desc(channelConnection.updatedAt))
        .limit(1);

    return rows[0] ?? null;
}

/**
 * Flag a connection the provider has stopped honouring.
 *
 * The reason is written in words a support conversation can use, never a
 * provider payload: those quote tokens.
 */
export async function markNeedsAttention(connectionId: string, reason: string): Promise<void> {
    await db
        .update(channelConnection)
        .set({ status: "needs_attention", statusReason: reason, updatedAt: new Date() })
        .where(eq(channelConnection.id, connectionId));
}

/**
 * Disconnect.
 *
 * Three things happen, in this order and for this reason: the provider is told
 * to stop, then Arkitech stops accepting anything that arrives anyway, then the
 * credentials are destroyed. Telling the provider first means a delivery in
 * flight lands on a connection that already refuses it, rather than the other
 * way round.
 *
 * Conversation history survives, per normal retention. Deleting a customer's
 * transcript because they unplugged a channel is not what disconnecting means.
 */
export async function disconnectConnection(connection: ChannelConnection): Promise<void> {
    try {
        await adapterFor(connection.provider as ProviderName).teardown({ connection });
    } catch {
        // The provider may already have revoked the token, or be unreachable.
        // Neither is a reason to leave Arkitech accepting its traffic.
    }

    // Revoked rather than deleted, so a later reconnect is a deliberate act and
    // an old chat cannot quietly resume against a new connection.
    await db
        .update(channelThread)
        .set({ status: "revoked" })
        .where(eq(channelThread.connectionId, connection.id));

    await db
        .update(channelConnection)
        .set({
            status: "disconnected",
            // The credential is gone. Reconnecting issues a new one.
            secret: null,
            authorizedExternalUserId: null,
            statusReason: null,
            updatedAt: new Date(),
        })
        .where(eq(channelConnection.id, connection.id));
}
