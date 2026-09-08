/**
 * Turns a Slack event callback into Arkitech's channel-neutral InboundMessage.
 *
 * The only place that knows what a Slack payload looks like. Like the Telegram
 * parser, it never throws on an unfamiliar shape: Slack retries anything that
 * does not return 200, so an exception here becomes four exceptions.
 */
import type { InboundMessage } from "../types";

type SlackEventCallback = {
    type?: string;
    team_id?: string;
    event_id?: string;
    event?: {
        type?: string;
        subtype?: string;
        channel?: string;
        channel_type?: string;
        user?: string;
        text?: string;
        ts?: string;
        thread_ts?: string;
        bot_id?: string;
        files?: unknown[];
    };
};

/** Slack's channel_type, mapped onto Arkitech's three kinds. */
function chatKind(channelType: string | undefined): InboundMessage["chatKind"] {
    if (channelType === "im") return "private";
    if (channelType === "channel" || channelType === "group" || channelType === "mpim") return "group";
    return "channel";
}

export function parseSlackEvent(payload: SlackEventCallback): InboundMessage | null {
    const event = payload?.event;

    if (payload?.type !== "event_callback" || !payload.event_id || !event) {
        return null;
    }

    if (event.type !== "message" || !event.channel || !event.user) {
        return null;
    }

    // Arkitech's own replies come back as events. Answering them would have the
    // Team member talking to itself, forever.
    if (event.bot_id) {
        return null;
    }

    // Edits, deletions, joins and the rest all arrive as `message` with a
    // subtype. None of them is somebody asking for work.
    if (event.subtype) {
        return null;
    }

    const text = event.text ?? null;

    return {
        provider: "slack",
        // Slack's own id for the delivery. Its retries reuse it, which is
        // exactly what the dedup claim needs.
        externalEventId: payload.event_id,
        externalChatId: event.channel,
        externalUserId: event.user,
        chatKind: chatKind(event.channel_type),
        // `ts` identifies a Slack message and doubles as the thread key.
        externalMessageId: event.ts ?? null,
        text,
        linkCode: null,
        unsupportedKind: !text && event.files?.length ? "file" : null,
    };
}
