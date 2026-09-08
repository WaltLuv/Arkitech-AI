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
import { postMessage, revokeToken, SlackApiError, splitForSlack } from "./client";

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

        for (const chunk of chunks) {
            const posted = await postMessage({
                token,
                channel: externalChatId,
                text: chunk,
                // Every chunk goes to the same place as the first. Threading
                // each one under the previous would nest a long answer inside
                // itself.
                threadTs: replyToExternalMessageId ?? null,
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

    isCredentialFailure(error: unknown): boolean {
        // Slack's own words for a token that has stopped working.
        if (error instanceof SlackApiError) {
            return ["invalid_auth", "account_inactive", "token_revoked", "not_authed"].includes(
                error.code,
            );
        }

        return error instanceof Error && /credentials/i.test(error.message);
    },
};
