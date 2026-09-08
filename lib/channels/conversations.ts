/**
 * Conversation and message persistence, shared by every channel.
 *
 * Before this, chat history lived in React state in the drawer and was replayed
 * to the server on each turn. That cannot serve a commercial multi-channel
 * product: a message arriving from Telegram has no browser tab to replay from,
 * and history that only exists in a component disappears on refresh. Arkitech
 * owns the transcript now, and the web drawer reads it back like any other
 * channel.
 *
 * Nothing here knows what a Telegram chat id or a Slack channel id is. Provider
 * identity lives in channelThread; this module deals in conversations, messages
 * and owners.
 */
import { conversation, db, message } from "@/db";
import { and, asc, desc, eq } from "drizzle-orm";

export type ChannelName = "web" | "telegram" | "slack";

/** How many past messages are replayed to the Agent as context. */
export const CONTEXT_MESSAGE_LIMIT = 20;

/**
 * Find the open conversation for an owner, Agent and channel, or start one.
 *
 * Web conversations are keyed by owner and Agent, so reopening the drawer
 * continues where it left off instead of starting a new thread. Provider
 * conversations are reached through their channelThread instead, because the
 * external chat is what identifies them.
 */
export async function getOrCreateWebConversation({
    userEmail,
    agentId,
}: {
    userEmail: string;
    agentId: string;
}) {
    const existing = await db
        .select()
        .from(conversation)
        .where(
            and(
                eq(conversation.userEmail, userEmail),
                eq(conversation.agentId, agentId),
                eq(conversation.channel, "web"),
                eq(conversation.status, "active"),
            ),
        )
        .orderBy(desc(conversation.lastMessageAt))
        .limit(1);

    if (existing[0]) {
        return existing[0];
    }

    const created = await db
        .insert(conversation)
        .values({ userEmail, agentId, channel: "web" })
        .returning();

    return created[0];
}

/**
 * Start a conversation for an external chat.
 *
 * Called only from the linking path, which has already established that the
 * person presenting the code holds the Arkitech account.
 */
export async function createChannelConversation({
    userEmail,
    agentId,
    channel,
    connectionId,
}: {
    userEmail: string;
    agentId: string;
    channel: ChannelName;
    connectionId: string;
}) {
    const created = await db
        .insert(conversation)
        .values({ userEmail, agentId, channel, connectionId })
        .returning();

    return created[0];
}

export async function recordMessage({
    conversationId,
    userEmail,
    direction,
    senderKind,
    body,
    status,
    runId,
    replyToId,
    externalMessageId,
    error,
}: {
    conversationId: string;
    userEmail: string;
    direction: "inbound" | "outbound";
    senderKind: "user" | "agent" | "system";
    body: string | null;
    status: "received" | "queued" | "sending" | "sent" | "failed";
    runId?: string | null;
    replyToId?: string | null;
    externalMessageId?: string | null;
    error?: string | null;
}) {
    const rows = await db
        .insert(message)
        .values({
            conversationId,
            userEmail,
            direction,
            senderKind,
            body,
            status,
            runId: runId ?? null,
            replyToId: replyToId ?? null,
            externalMessageId: externalMessageId ?? null,
            error: error ?? null,
        })
        .returning();

    // Keeps the conversation list sortable without touching messages.
    await db
        .update(conversation)
        .set({ lastMessageAt: rows[0].createdAt, updatedAt: new Date() })
        .where(eq(conversation.id, conversationId));

    return rows[0];
}

export async function updateMessageDelivery({
    messageId,
    status,
    externalMessageId,
    error,
}: {
    messageId: string;
    status: "queued" | "sending" | "sent" | "failed";
    externalMessageId?: string | null;
    error?: string | null;
}) {
    await db
        .update(message)
        .set({
            status,
            ...(externalMessageId !== undefined ? { externalMessageId } : {}),
            ...(error !== undefined ? { error } : {}),
        })
        .where(eq(message.id, messageId));
}

/**
 * The transcript, oldest first, owner-scoped.
 *
 * The owner is part of the predicate rather than assumed from the conversation
 * id, so a leaked or guessed id cannot read someone else's messages.
 */
export async function loadConversationMessages({
    conversationId,
    userEmail,
    limit = CONTEXT_MESSAGE_LIMIT,
}: {
    conversationId: string;
    userEmail: string;
    limit?: number;
}) {
    const rows = await db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, conversationId), eq(message.userEmail, userEmail)))
        .orderBy(desc(message.createdAt))
        .limit(limit);

    return rows.reverse();
}

/**
 * Build the Agent's input from stored history.
 *
 * The shape is the one the web drawer used to send from the browser, kept
 * deliberately: the Agent's instructions were written against it, and changing
 * the transcript format is a change to every Agent's behaviour, not a
 * refactor. Failed sends are left out because the person never saw them.
 */
export function buildAgentInput(
    history: { direction: string; senderKind: string; body: string | null; status: string }[],
): string {
    const turns = history
        .filter(row => row.body && row.senderKind !== "system" && row.status !== "failed")
        .map(row => ({
            role: row.direction === "inbound" ? "user" : "agent",
            content: row.body as string,
        }));

    return JSON.stringify(turns);
}

/** Newest conversations for an owner, for the web surface. */
export async function listConversationsForOwner(userEmail: string, limit = 50) {
    return db
        .select()
        .from(conversation)
        .where(eq(conversation.userEmail, userEmail))
        .orderBy(desc(conversation.lastMessageAt), asc(conversation.createdAt))
        .limit(limit);
}
