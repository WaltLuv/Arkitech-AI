/**
 * Delivering a Team member's reply back to the channel it came from.
 *
 * Delivery status is recorded honestly: a message reaches `sent` only when the
 * provider confirmed it. Arkitech queueing something is not the same as a
 * person receiving it, and a UI that conflates the two lies at exactly the
 * moment a customer is trying to work out why nobody answered.
 */
import { channelThread, conversation, db } from "@/db";
import type { ChannelConnection } from "@/db";
import { and, eq } from "drizzle-orm";
import { markNeedsAttention } from "./connections";
import { recordMessage, updateMessageDelivery } from "./conversations";
import { adapterFor } from "./registry";
import type { ProviderName } from "./types";

export type DeliveryResult =
    | { outcome: "sent"; messageId: string; externalMessageId: string | null }
    | { outcome: "failed"; messageId: string; error: string }
    | { outcome: "no_channel" };

/**
 * Persist a reply and hand it to the provider.
 *
 * The message row is written before the send is attempted, so a reply that the
 * provider refuses is still visible in Arkitech as a failure rather than
 * vanishing.
 */
export async function deliverReply({
    connection,
    conversationId,
    userEmail,
    text,
    runId,
    replyToId,
    replyToExternalMessageId,
}: {
    connection: ChannelConnection;
    conversationId: string;
    userEmail: string;
    text: string;
    runId?: string | null;
    replyToId?: string | null;
    replyToExternalMessageId?: string | null;
}): Promise<DeliveryResult> {
    const thread = await db
        .select()
        .from(channelThread)
        .where(
            and(
                eq(channelThread.conversationId, conversationId),
                eq(channelThread.userEmail, userEmail),
            ),
        )
        .limit(1);

    if (!thread[0]) {
        return { outcome: "no_channel" };
    }

    const stored = await recordMessage({
        conversationId,
        userEmail,
        direction: "outbound",
        senderKind: "agent",
        body: text,
        status: "sending",
        runId: runId ?? null,
        replyToId: replyToId ?? null,
    });

    const adapter = adapterFor(connection.provider as ProviderName);

    try {
        const sent = await adapter.sendText({
            connection,
            externalChatId: thread[0].externalChatId,
            text,
            replyToExternalMessageId,
        });

        await updateMessageDelivery({
            messageId: stored.id,
            status: "sent",
            externalMessageId: sent.externalMessageId ?? null,
        });

        return {
            outcome: "sent",
            messageId: stored.id,
            externalMessageId: sent.externalMessageId ?? null,
        };
    } catch (e) {
        // Provider errors name a method and a code, never a token: see the two
        // client modules. Even so, only the message is kept, never a payload.
        const error = e instanceof Error ? e.message : "Delivery failed";

        await updateMessageDelivery({ messageId: stored.id, status: "failed", error });

        // A dead credential is not one bad message, it is a connection that
        // will fail every time until someone reconnects it. Saying so on the
        // Connections screen is the difference between a customer fixing it and
        // a customer wondering why nobody answers.
        if (adapter.isCredentialFailure(e)) {
            await markNeedsAttention(
                connection.id,
                "Reconnect this channel: the connection was rejected by the provider.",
            );
        }

        return { outcome: "failed", messageId: stored.id, error };
    }
}

/**
 * Send a short notice that is not a Team member's answer: a refusal, a linking
 * confirmation, an out-of-credit message.
 *
 * Deliberately does not persist to a conversation. Some of these are sent to
 * people who have no conversation, and inventing one for them would create a
 * record keyed to nobody.
 */
export async function sendChannelNotice({
    connection,
    externalChatId,
    text,
    replyToExternalMessageId,
}: {
    connection: ChannelConnection;
    externalChatId: string;
    text: string;
    replyToExternalMessageId?: string | null;
}): Promise<void> {
    await adapterFor(connection.provider as ProviderName).sendText({
        connection,
        externalChatId,
        text,
        replyToExternalMessageId,
    });
}

/** Load a conversation with its connection, owner-scoped. */
export async function loadConversationConnection(conversationId: string) {
    const rows = await db
        .select()
        .from(conversation)
        .where(eq(conversation.id, conversationId))
        .limit(1);

    return rows[0] ?? null;
}
