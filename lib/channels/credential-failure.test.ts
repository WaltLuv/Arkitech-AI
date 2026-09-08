import { describe, expect, it } from "vitest";

import { telegramAdapter } from "@/lib/channels/telegram/adapter";
import { TelegramApiError } from "@/lib/channels/telegram/client";
import { slackAdapter } from "@/lib/channels/slack/adapter";
import { SlackApiError } from "@/lib/channels/slack/client";

/**
 * Telling "this connection is finished" apart from "this one message was
 * refused" decides whether the Connections screen asks someone to reconnect.
 * Getting it wrong in either direction is bad: a customer chasing a connection
 * that works, or one that quietly never answers again.
 */
describe("telegram credential failures", () => {
    it("treats a dead token as a credential failure", () => {
        expect(telegramAdapter.isCredentialFailure(new TelegramApiError("sendMessage", "Unauthorized", 401))).toBe(true);
    });

    it("does not treat a blocked bot as a credential failure", () => {
        // The person blocked the bot. That is their choice, and the connection
        // is fine for everyone else.
        expect(
            telegramAdapter.isCredentialFailure(
                new TelegramApiError("sendMessage", "Forbidden: bot was blocked by the user", 403),
            ),
        ).toBe(false);
    });

    it("does not treat a missing chat as a credential failure", () => {
        expect(
            telegramAdapter.isCredentialFailure(new TelegramApiError("sendMessage", "chat not found", 400)),
        ).toBe(false);
    });

    it("treats an unopenable envelope as a credential failure", () => {
        expect(
            telegramAdapter.isCredentialFailure(new Error("Telegram connection credentials are incomplete")),
        ).toBe(true);
    });

    it("does not treat a network error as a credential failure", () => {
        expect(telegramAdapter.isCredentialFailure(new Error("fetch failed"))).toBe(false);
    });
});

describe("slack credential failures", () => {
    it.each(["invalid_auth", "account_inactive", "token_revoked", "not_authed"])(
        "treats %s as a credential failure",
        code => {
            expect(slackAdapter.isCredentialFailure(new SlackApiError("chat.postMessage", code))).toBe(true);
        },
    );

    it.each(["channel_not_found", "msg_too_long", "rate_limited"])(
        "does not treat %s as a credential failure",
        code => {
            expect(slackAdapter.isCredentialFailure(new SlackApiError("chat.postMessage", code))).toBe(false);
        },
    );

    it("does not treat a network error as a credential failure", () => {
        expect(slackAdapter.isCredentialFailure(new Error("fetch failed"))).toBe(false);
    });
});
