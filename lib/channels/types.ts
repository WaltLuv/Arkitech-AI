/**
 * The channel-neutral vocabulary.
 *
 * A provider adapter's whole job is to turn its own payload into an
 * InboundMessage and to deliver an OutboundMessage. Everything between those
 * two points is shared, and knows nothing about Telegram or Slack.
 */
import type { ChannelConnection } from "@/db";

export type ProviderName = "telegram" | "slack";

/** What a provider is allowed to tell the rest of Arkitech about an event. */
export type InboundMessage = {
    provider: ProviderName;

    /** The provider's id for this delivery. Telegram update_id, Slack event_id. */
    externalEventId: string;

    /** The chat or channel it belongs to. */
    externalChatId: string;

    /** The person who sent it. */
    externalUserId: string;

    /**
     * Only `private` is served today. A group arriving here is recognised and
     * refused rather than mistaken for a private chat.
     */
    chatKind: "private" | "group" | "channel";

    /** The provider's id for the message itself, where it has one. */
    externalMessageId?: string | null;

    text: string | null;

    /**
     * A one-time link code the sender presented, if this delivery was a linking
     * attempt rather than ordinary conversation.
     */
    linkCode?: string | null;

    /**
     * Set when the provider sent something Arkitech does not handle yet. The
     * pipeline answers with a plain-language note instead of failing.
     */
    unsupportedKind?: string | null;
};

export type OutboundResult = {
    externalMessageId?: string | null;
};

/**
 * What a provider must implement. Deliberately small: everything a channel
 * needs beyond this is either shared or belongs in the provider's own module.
 */
export type ChannelAdapter = {
    provider: ProviderName;

    /** Deliver a reply. Throws when the provider refused it. */
    sendText(args: {
        connection: ChannelConnection;
        externalChatId: string;
        text: string;
        replyToExternalMessageId?: string | null;
    }): Promise<OutboundResult>;

    /** Stop receiving events. Called on disconnect; must tolerate being late. */
    teardown(args: { connection: ChannelConnection }): Promise<void>;

    /**
     * True when a failed call means the credential itself is finished, rather
     * than this one message being refused. Only the provider can tell those
     * apart: a Telegram 403 usually means the person blocked the bot, which is
     * their choice and not a broken connection, while a 401 means the token is
     * dead and nothing will work until it is replaced.
     */
    isCredentialFailure(error: unknown): boolean;
};
