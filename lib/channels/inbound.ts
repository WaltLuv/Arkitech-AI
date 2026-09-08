/**
 * The shared inbound pipeline. Every channel enters Arkitech here.
 *
 * The order below is the security model, and it is the same for every provider:
 *
 *   verified request (the provider's route did this)
 *     -> connection            which Arkitech account owns this bot or install
 *     -> deduplication         this delivery has not been handled before
 *     -> authorised identity   this chat was linked by someone holding the account
 *     -> Team member           the Agent that connection answers with
 *     -> conversation          owned by that account
 *     -> persist
 *     -> hand to the existing Agent path
 *
 * No Agent is built until every step has passed. Reaching a bot's public
 * username gets someone as far as step three and no further.
 *
 * The Agent itself runs later, in a background function. Slack requires a 200
 * within three seconds and retries otherwise, and Telegram re-delivers an
 * update whose webhook was slow; an Agent turn takes considerably longer than
 * that. Answering first and working afterwards is what keeps one message from
 * becoming four.
 */
import { channelThread, conversation, db } from "@/db";
import type { ChannelConnection } from "@/db";
import { inngest } from "@/inngest/client";
import { and, eq } from "drizzle-orm";
import { claimInboundEvent } from "./dedup";
import { createChannelConversation, recordMessage } from "./conversations";
import { redeemLinkCode } from "./linking";
import type { InboundMessage } from "./types";

/** Sent when someone who is not linked messages the bot. */
export const UNLINKED_REPLY =
    "This assistant is not connected to you yet. Open Arkitech, go to Settings, Connections, and use the link there to start the chat.";

/** Sent when a linking attempt fails. Deliberately says nothing about why. */
export const LINK_FAILED_REPLY =
    "That link has expired or was already used. Open Arkitech, go to Settings, Connections, and start the connection again.";

/** Sent for a group chat, which the first release does not serve. */
export const GROUP_UNSUPPORTED_REPLY =
    "I can only work in a direct message for now. Send me a private message instead.";

export type InboundOutcome =
    /** Handled: an Agent turn was queued. */
    | { outcome: "queued"; conversationId: string; messageId: string }
    /** A retry of something already handled. Nothing was done, and that is correct. */
    | { outcome: "duplicate" }
    /** The chat was linked to an account just now. */
    | { outcome: "linked"; reply: string }
    /** Refused. `reply` is what to say, if anything. */
    | { outcome: "refused"; reason: string; reply?: string }
    /** Nothing to do: an edit, a reaction, a bot's own echo. */
    | { outcome: "ignored"; reason: string };

/**
 * Handle one inbound message from any provider.
 *
 * Callers have already verified the request came from the provider and have
 * resolved which connection it belongs to. Everything after that is here.
 */
export async function receiveInboundMessage({
    connection,
    inbound,
    alreadyClaimed = false,
    alreadyAutoLinked = false,
}: {
    connection: ChannelConnection;
    inbound: InboundMessage;
    /** Set only by the pipeline re-entering itself; never by a route. */
    alreadyClaimed?: boolean;
    /**
     * Also set only on re-entry. Auto-linking opens a thread and then re-runs
     * the pipeline to handle the message through the ordinary path. If that
     * second pass still cannot see the thread, the answer is to refuse, not to
     * open another one: without this the two would call each other forever.
     */
    alreadyAutoLinked?: boolean;
}): Promise<InboundOutcome> {
    // Claimed before anything else happens, so a retry that races the original
    // stops here rather than at some later step that has already had an effect.
    const claimed =
        alreadyClaimed ||
        (await claimInboundEvent({
            connectionId: connection.id,
            provider: inbound.provider,
            externalEventId: inbound.externalEventId,
        }));

    if (!claimed) {
        return { outcome: "duplicate" };
    }

    if (connection.status === "disconnected") {
        return { outcome: "refused", reason: "connection_disconnected" };
    }

    // A linking attempt is the one thing an unlinked chat may do.
    if (inbound.linkCode) {
        return linkChat({ connection, inbound });
    }

    const thread = await db
        .select()
        .from(channelThread)
        .where(
            and(
                eq(channelThread.connectionId, connection.id),
                eq(channelThread.externalChatId, inbound.externalChatId),
            ),
        )
        .limit(1);

    const existing = thread[0];

    if (!existing) {
        // Some connect flows prove who the person is before a message is ever
        // sent: installing the Slack app is done from inside the workspace by a
        // signed-in Arkitech user. That user's first direct message opens the
        // conversation, and nobody else's does.
        const preauthorized =
            !alreadyAutoLinked &&
            connection.authorizedExternalUserId &&
            connection.authorizedExternalUserId === inbound.externalUserId &&
            inbound.chatKind === "private" &&
            connection.status === "active";

        if (preauthorized) {
            return openPreauthorizedChat({ connection, inbound });
        }

        // Anyone can find a bot. Being able to message it is not authorisation.
        return { outcome: "refused", reason: "not_linked", reply: UNLINKED_REPLY };
    }

    if (existing.status !== "active") {
        return { outcome: "refused", reason: "link_revoked", reply: UNLINKED_REPLY };
    }

    // The linked chat belongs to one person. A second account in the same chat
    // is not the person who linked it.
    if (existing.externalUserId && existing.externalUserId !== inbound.externalUserId) {
        return { outcome: "refused", reason: "unauthorized_user", reply: UNLINKED_REPLY };
    }

    if (inbound.chatKind !== "private") {
        return { outcome: "refused", reason: "group_unsupported", reply: GROUP_UNSUPPORTED_REPLY };
    }

    if (connection.status !== "active") {
        return { outcome: "refused", reason: `connection_${connection.status}` };
    }

    if (inbound.unsupportedKind) {
        return {
            outcome: "refused",
            reason: `unsupported_${inbound.unsupportedKind}`,
            reply: `I can only read text messages at the moment, so I could not open that ${inbound.unsupportedKind}. Could you describe it instead?`,
        };
    }

    const text = inbound.text?.trim();

    if (!text) {
        return { outcome: "ignored", reason: "empty_message" };
    }

    const owned = await db
        .select()
        .from(conversation)
        .where(
            and(
                eq(conversation.id, existing.conversationId),
                eq(conversation.userEmail, connection.userEmail),
            ),
        )
        .limit(1);

    const target = owned[0];

    if (!target) {
        return { outcome: "refused", reason: "conversation_missing", reply: UNLINKED_REPLY };
    }

    const stored = await recordMessage({
        conversationId: target.id,
        userEmail: connection.userEmail,
        direction: "inbound",
        senderKind: "user",
        body: text,
        status: "received",
        externalMessageId: inbound.externalMessageId ?? null,
    });

    try {
        await inngest.send({
            name: "channel/message.received",
            data: { messageId: stored.id, conversationId: target.id },
        });
    } catch (e) {
        // Nothing ran, so leave no trace of an arrival Arkitech cannot act on.
        // Undoing the claim as well lets the provider's own retry deliver it
        // again, which is the behaviour the retry exists for.
        await unwind({ messageId: stored.id, connectionId: connection.id, inbound });
        throw e;
    }

    return { outcome: "queued", conversationId: target.id, messageId: stored.id };
}

/**
 * Bind an external chat to the Arkitech account that issued the code.
 *
 * The code is redeemed first, and redemption is single-use at the database, so
 * two people presenting the same code cannot both end up linked.
 */
async function linkChat({
    connection,
    inbound,
}: {
    connection: ChannelConnection;
    inbound: InboundMessage;
}): Promise<InboundOutcome> {
    if (inbound.chatKind !== "private") {
        return { outcome: "refused", reason: "group_unsupported", reply: GROUP_UNSUPPORTED_REPLY };
    }

    const redeemed = await redeemLinkCode(inbound.linkCode as string);

    if (!redeemed || redeemed.connectionId !== connection.id) {
        return { outcome: "refused", reason: "invalid_link_code", reply: LINK_FAILED_REPLY };
    }

    if (!connection.defaultAgentId) {
        return { outcome: "refused", reason: "no_default_agent", reply: LINK_FAILED_REPLY };
    }

    // A chat that is already linked is re-pointed rather than duplicated: the
    // unique index on (connection, chat) would refuse a second row anyway, and
    // re-linking is how someone recovers a chat they revoked.
    const existing = await db
        .select()
        .from(channelThread)
        .where(
            and(
                eq(channelThread.connectionId, connection.id),
                eq(channelThread.externalChatId, inbound.externalChatId),
            ),
        )
        .limit(1);

    if (existing[0]) {
        await db
            .update(channelThread)
            .set({ status: "active", externalUserId: inbound.externalUserId })
            .where(eq(channelThread.id, existing[0].id));

        return { outcome: "linked", reply: linkedReply() };
    }

    const created = await createChannelConversation({
        userEmail: redeemed.userEmail,
        agentId: connection.defaultAgentId,
        channel: inbound.provider,
        connectionId: connection.id,
    });

    await db.insert(channelThread).values({
        conversationId: created.id,
        connectionId: connection.id,
        userEmail: redeemed.userEmail,
        provider: inbound.provider,
        externalChatId: inbound.externalChatId,
        externalUserId: inbound.externalUserId,
        chatKind: inbound.chatKind,
    });

    await recordMessage({
        conversationId: created.id,
        userEmail: redeemed.userEmail,
        direction: "outbound",
        senderKind: "system",
        body: linkedReply(),
        status: "queued",
    });

    return { outcome: "linked", reply: linkedReply() };
}

/**
 * Open a conversation for a person the connect flow already authorised.
 *
 * Creates the thread and then re-enters the pipeline, so this message is
 * handled by exactly the same code as every message after it rather than by a
 * shortened copy of it. The dedup claim has already been taken, so the retry
 * passes `alreadyClaimed`.
 */
async function openPreauthorizedChat({
    connection,
    inbound,
}: {
    connection: ChannelConnection;
    inbound: InboundMessage;
}): Promise<InboundOutcome> {
    if (!connection.defaultAgentId) {
        return { outcome: "refused", reason: "no_default_agent" };
    }

    const created = await createChannelConversation({
        userEmail: connection.userEmail,
        agentId: connection.defaultAgentId,
        channel: inbound.provider,
        connectionId: connection.id,
    });

    await db
        .insert(channelThread)
        .values({
            conversationId: created.id,
            connectionId: connection.id,
            userEmail: connection.userEmail,
            provider: inbound.provider,
            externalChatId: inbound.externalChatId,
            externalUserId: inbound.externalUserId,
            chatKind: inbound.chatKind,
        })
        // Two messages arriving together must not create two conversations for
        // one chat. The loser of the race continues on the winner's thread.
        .onConflictDoNothing({
            target: [channelThread.connectionId, channelThread.externalChatId],
        });

    return receiveInboundMessage({
        connection,
        inbound,
        alreadyClaimed: true,
        alreadyAutoLinked: true,
    });
}

function linkedReply(): string {
    return "You're connected. Send me whatever you need done and I'll get started.";
}

/** Remove a persisted arrival and its dedup claim, so a retry can try again. */
async function unwind({
    messageId,
    connectionId,
    inbound,
}: {
    messageId: string;
    connectionId: string;
    inbound: InboundMessage;
}): Promise<void> {
    const { message, channelInboundEvent } = await import("@/db");

    await db.delete(message).where(eq(message.id, messageId));
    await db
        .delete(channelInboundEvent)
        .where(
            and(
                eq(channelInboundEvent.connectionId, connectionId),
                eq(channelInboundEvent.provider, inbound.provider),
                eq(channelInboundEvent.externalEventId, inbound.externalEventId),
            ),
        );
}
