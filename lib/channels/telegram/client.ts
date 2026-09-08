/**
 * Telegram Bot API client.
 *
 * Every call is server-side. The bot token is a bearer credential that sits in
 * the URL path of Telegram's own API, which is why nothing here ever puts a
 * response or a request URL into an error message: a thrown string that quotes
 * the URL quotes the token with it.
 *
 * Verified against the Bot API reference: methods are POSTed to
 * https://api.telegram.org/bot<token>/<method>, every response is a JSON object
 * with an `ok` boolean, and failures carry `description` and `error_code`.
 */

const API_ROOT = "https://api.telegram.org";

/** Telegram refuses a message over 4096 characters. */
export const MAX_MESSAGE_LENGTH = 4096;

/** Bots may download files up to 20MB through getFile. */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export class TelegramApiError extends Error {
    readonly errorCode: number | null;

    constructor(method: string, description: string, errorCode: number | null) {
        // The method and Telegram's own description, never the URL or a token.
        super(`Telegram ${method} failed: ${description}`);
        this.name = "TelegramApiError";
        this.errorCode = errorCode;
    }
}

async function call<T>(token: string, method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params ?? {}),
        // A webhook handler must answer quickly; a hung provider call must not
        // be what stops it.
        signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; result?: T; description?: string; error_code?: number }
        | null;

    if (!payload?.ok) {
        throw new TelegramApiError(
            method,
            payload?.description ?? `HTTP ${response.status}`,
            payload?.error_code ?? null,
        );
    }

    return payload.result as T;
}

export type TelegramBot = {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
};

/** Confirms a token is real and tells us who it belongs to. */
export function getMe(token: string): Promise<TelegramBot> {
    return call<TelegramBot>(token, "getMe");
}

/**
 * Point the bot at Arkitech.
 *
 * `secret_token` is the part that matters: Telegram then sends every update
 * with an X-Telegram-Bot-Api-Secret-Token header carrying it, which is how the
 * webhook can tell Telegram apart from anyone else who guessed the URL. The
 * documented alphabet is A-Z, a-z, 0-9, underscore and hyphen, 1-256 characters.
 *
 * `allowed_updates` is narrowed to messages, because that is all Arkitech acts
 * on and there is no reason to receive the rest.
 */
export function setWebhook(
    token: string,
    url: string,
    secretToken: string,
): Promise<boolean> {
    return call<boolean>(token, "setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: ["message"],
        // Anything queued while the bot was pointed elsewhere belongs to that
        // other install, not to this one.
        drop_pending_updates: true,
    });
}

export function deleteWebhook(token: string): Promise<boolean> {
    return call<boolean>(token, "deleteWebhook", { drop_pending_updates: true });
}

export type WebhookInfo = {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    last_error_date?: number;
    last_error_message?: string;
};

export function getWebhookInfo(token: string): Promise<WebhookInfo> {
    return call<WebhookInfo>(token, "getWebhookInfo");
}

export type SentMessage = { message_id: number };

/**
 * Send a reply.
 *
 * Sent as plain text on purpose. Agent output is Markdown, and Telegram's
 * MarkdownV2 requires more than a dozen characters to be escaped; an unescaped
 * underscore in a filename is enough for Telegram to refuse the whole message.
 * A refused reply is worse than an unstyled one.
 */
export function sendMessage(
    token: string,
    chatId: string,
    text: string,
    replyToMessageId?: number | null,
): Promise<SentMessage> {
    return call<SentMessage>(token, "sendMessage", {
        chat_id: chatId,
        text,
        ...(replyToMessageId
            ? { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }
            : {}),
    });
}

/**
 * Split text Telegram would otherwise refuse.
 *
 * Prefers a paragraph or line break near the limit so a split lands between
 * thoughts rather than mid-word.
 */
export function splitForTelegram(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= limit) {
        return [text];
    }

    const chunks: string[] = [];
    let rest = text;

    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
        const cut = breakAt > limit * 0.5 ? breakAt : limit;

        chunks.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }

    if (rest) {
        chunks.push(rest);
    }

    return chunks;
}
