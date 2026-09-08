/**
 * Turns a Telegram Update into Arkitech's channel-neutral InboundMessage.
 *
 * This is the only place that knows what a Telegram payload looks like. It is
 * deliberately tolerant: an update carrying something Arkitech does not handle
 * becomes an `unsupportedKind` the pipeline can answer politely, never an
 * exception. A webhook that throws on an unfamiliar update type is a webhook
 * Telegram retries forever.
 */
import type { InboundMessage } from "../types";

/** Only the fields Arkitech reads. Telegram sends a great deal more. */
type TelegramUpdate = {
    update_id?: number;
    message?: {
        message_id?: number;
        from?: { id?: number; is_bot?: boolean };
        chat?: { id?: number | string; type?: string };
        text?: string;
        caption?: string;
        photo?: unknown[];
        document?: unknown;
        voice?: unknown;
        audio?: unknown;
        video?: unknown;
        sticker?: unknown;
        location?: unknown;
    };
};

/** Telegram's chat.type values, mapped onto Arkitech's three kinds. */
function chatKind(type: string | undefined): InboundMessage["chatKind"] {
    if (type === "private") return "private";
    if (type === "channel") return "channel";
    return "group";
}

/**
 * Names what arrived when it is not text, so the reply can say so.
 * Ordered by how likely it is to be the point of the message.
 */
function unsupportedKind(msg: NonNullable<TelegramUpdate["message"]>): string | null {
    if (msg.photo) return "photo";
    if (msg.document) return "file";
    if (msg.voice) return "voice message";
    if (msg.audio) return "audio file";
    if (msg.video) return "video";
    if (msg.sticker) return "sticker";
    if (msg.location) return "location";
    return null;
}

export function parseTelegramUpdate(update: TelegramUpdate): InboundMessage | null {
    if (typeof update?.update_id !== "number") {
        return null;
    }

    const msg = update.message;

    // Arkitech subscribes to `message` only, so anything else is a narrowing
    // that has not taken effect yet, or an update type Telegram added later.
    if (!msg?.chat?.id || !msg.from?.id) {
        return null;
    }

    // A bot's own messages, including this bot's, are never conversation.
    if (msg.from.is_bot) {
        return null;
    }

    const text = msg.text ?? msg.caption ?? null;

    // Telegram deep links arrive as the literal text "/start <payload>", which
    // is how a one-time link code gets from Arkitech into the chat.
    const startMatch = text?.match(/^\/start(?:\s+(\S+))?$/);
    const linkCode = startMatch?.[1] ?? null;

    return {
        provider: "telegram",
        externalEventId: String(update.update_id),
        externalChatId: String(msg.chat.id),
        externalUserId: String(msg.from.id),
        chatKind: chatKind(msg.chat.type),
        externalMessageId: msg.message_id != null ? String(msg.message_id) : null,
        // A bare /start is a greeting, not a message to answer.
        text: startMatch ? null : text,
        linkCode,
        unsupportedKind: text ? null : unsupportedKind(msg),
    };
}
