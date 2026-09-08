/**
 * Slack's implementation of the shared ChannelAdapter.
 *
 * The bot token belongs to one workspace install and is sealed per connection.
 * The signing secret is not here: it belongs to the Arkitech Slack app as a
 * whole, is identical for every install, and lives in the server environment.
 */
import type { ChannelConnection } from "@/db";
import { openSecret } from "../secrets";
import type { ChannelAdapter, OutboundResult } from "../types";
import { postMessage, revokeToken, splitForSlack } from "./client";

export function slackBotToken(connection: ChannelConnection): string {
    if (!connection.secret) {
        throw new Error("Slack connection has no stored credentials");
    }

    const opened = openSecret(connection.secret);

    if (!opened.botToken) {
        throw new Error("Slack connection credentials are incomplete");
    }

    return opened.botToken;
}

export const slackAdapter: ChannelAdapter = {
    provider: "slack",

    async sendText({ connection, externalChatId, text, replyToExternalMessageId }): Promise<OutboundResult> {
        const token = slackBotToken(connection);

        const chunks = splitForSlack(text);
        let lastTs: string | null = null;

        for (const [index, chunk] of chunks.entries()) {
            const posted = await postMessage({
                token,
                channel: externalChatId,
                text: chunk,
                // Slack threads by the parent message's ts. Only the first
                // chunk needs it; the rest follow into the same thread.
                threadTs: index === 0 ? replyToExternalMessageId ?? null : lastTs,
            });

            lastTs = posted.ts;
        }

        return { externalMessageId: lastTs };
    },

    async teardown({ connection }): Promise<void> {
        // Slack event delivery belongs to the app, not to one install, so there
        // is no subscription to delete. Revoking the workspace's token is what
        // actually ends Arkitech's access to it.
        await revokeToken(slackBotToken(connection));
    },
};
