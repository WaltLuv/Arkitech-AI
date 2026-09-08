/**
 * Telegram's implementation of the shared ChannelAdapter.
 *
 * Opens the connection's sealed credentials only at the moment a call needs
 * them, and hands nothing provider-specific back to the caller.
 */
import type { ChannelConnection } from "@/db";
import { openSecret } from "../secrets";
import type { ChannelAdapter, OutboundResult } from "../types";
import { deleteWebhook, sendMessage, splitForTelegram, TelegramApiError } from "./client";

export type TelegramCredentials = {
    botToken: string;
    webhookSecret: string;
};

export function telegramCredentials(connection: ChannelConnection): TelegramCredentials {
    if (!connection.secret) {
        throw new Error("Telegram connection has no stored credentials");
    }

    const opened = openSecret(connection.secret);

    if (!opened.botToken || !opened.webhookSecret) {
        throw new Error("Telegram connection credentials are incomplete");
    }

    return { botToken: opened.botToken, webhookSecret: opened.webhookSecret };
}

export const telegramAdapter: ChannelAdapter = {
    provider: "telegram",

    async sendText({ connection, externalChatId, text, replyToExternalMessageId }): Promise<OutboundResult> {
        const { botToken } = telegramCredentials(connection);

        const chunks = splitForTelegram(text);
        let lastId: string | null = null;

        // Only the first chunk answers the original message. Threading every
        // chunk to it would quote the same message repeatedly in the client.
        for (const [index, chunk] of chunks.entries()) {
            const sent = await sendMessage(
                botToken,
                externalChatId,
                chunk,
                index === 0 && replyToExternalMessageId ? Number(replyToExternalMessageId) : null,
            );

            lastId = String(sent.message_id);
        }

        return { externalMessageId: lastId };
    },

    async teardown({ connection }): Promise<void> {
        const { botToken } = telegramCredentials(connection);
        await deleteWebhook(botToken);
    },

    isCredentialFailure(error: unknown): boolean {
        // 401 is a dead token. 403 is deliberately not included: it is mostly
        // "bot was blocked by the user", which is that person's decision and
        // says nothing about the connection.
        if (error instanceof TelegramApiError) {
            return error.errorCode === 401;
        }

        // An envelope that will not open is a credential problem too, and the
        // only way out of it is reconnecting.
        return error instanceof Error && /credentials/i.test(error.message);
    },
};
