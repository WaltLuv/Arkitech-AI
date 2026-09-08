import { describe, expect, it } from "vitest";

/**
 * Live verification against the real Telegram and Slack APIs.
 *
 * Everything else in this directory proves behaviour offline against fixtures.
 * This file proves the part only the providers can answer: that the calls
 * Arkitech makes are the calls they actually accept, with the parameter names
 * and shapes they actually expect today.
 *
 * Skipped unless asked for, because it needs real credentials and sends real
 * messages:
 *
 *     set -a && . ./.env.local && set +a
 *     LIVE_TELEGRAM=1 npx vitest run lib/channels/live.test.ts
 *     LIVE_SLACK=1 npx vitest run lib/channels/live.test.ts
 *
 * Two rules, the same two the Browserbase live suite runs under.
 *
 * No secret may reach the output. A failing `expect` prints both operands, so
 * nothing here asserts on a token, a URL containing one, or a provider payload;
 * assertions are made on booleans and on fields computed beforehand.
 *
 * Nothing consequential happens. The bot messages only the chat named in the
 * configuration, which is a disposable test chat the operator controls, and the
 * webhook it registers points at a host that does not exist and is deleted
 * again in the same test.
 *
 * What this cannot cover, and no CI can: a real inbound message arriving at a
 * running Arkitech. That needs a deployed instance with a public HTTPS address
 * for the provider to call. The manual checklist for it is in
 * docs/channels-live-verification.md.
 */
import { getMe, getWebhookInfo, deleteWebhook, sendMessage, setWebhook } from "./telegram/client";
import { authTest, postMessage } from "./slack/client";

const telegramToken = process.env.TELEGRAM_TEST_BOT_TOKEN ?? "";
const telegramChat = process.env.TELEGRAM_TEST_CHAT_ID ?? "";
const slackToken = process.env.SLACK_TEST_BOT_TOKEN ?? "";
const slackChannel = process.env.SLACK_TEST_CHANNEL ?? "";

const runTelegram = process.env.LIVE_TELEGRAM === "1" && Boolean(telegramToken);
const runSlack = process.env.LIVE_SLACK === "1" && Boolean(slackToken);

/** A host that resolves nowhere. Telegram accepts the registration regardless. */
const PROBE_WEBHOOK = "https://arkitech-live-verification.invalid/api/channels/telegram/webhook/probe";

describe.skipIf(!runTelegram)("Telegram, live", () => {
    it("accepts the token and identifies the bot", async () => {
        const bot = await getMe(telegramToken);

        expect(bot.is_bot).toBe(true);
        expect(typeof bot.id).toBe("number");
    });

    it("registers a webhook with a secret token and reports it back", async () => {
        // The parameter names are the whole point of this test: a rename on
        // Telegram's side would silently stop authenticating the webhook.
        const secret = "arkitech-live-verification-secret";

        await expect(setWebhook(telegramToken, PROBE_WEBHOOK, secret)).resolves.toBe(true);

        const info = await getWebhookInfo(telegramToken);

        expect(info.url).toBe(PROBE_WEBHOOK);
    });

    it("removes the webhook again", async () => {
        await expect(deleteWebhook(telegramToken)).resolves.toBe(true);

        const info = await getWebhookInfo(telegramToken);

        expect(info.url).toBe("");
    });

    it.skipIf(!telegramChat)("delivers a message to the test chat", async () => {
        const sent = await sendMessage(
            telegramToken,
            telegramChat,
            "Arkitech live verification. This message confirms outbound delivery works.",
        );

        expect(typeof sent.message_id).toBe("number");
    });

    it("reports a refusal without leaking the token", async () => {
        // The error carries the method and Telegram's description. If it ever
        // carried the request URL it would carry the token with it.
        let message = "";

        try {
            await sendMessage(telegramToken, "0", "should not arrive");
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }

        expect(message).not.toBe("");
        expect(message.includes(telegramToken)).toBe(false);
    });
});

describe.skipIf(!runSlack)("Slack, live", () => {
    it("accepts the token and identifies the workspace", async () => {
        const identity = await authTest(slackToken);

        expect(typeof identity.team_id).toBe("string");
        expect(identity.team_id.length).toBeGreaterThan(0);
    });

    it.skipIf(!slackChannel)("delivers a message to the test channel", async () => {
        const posted = await postMessage({
            token: slackToken,
            channel: slackChannel,
            text: "Arkitech live verification. This message confirms outbound delivery works.",
        });

        expect(typeof posted.ts).toBe("string");
    });

    it("reports a refusal without leaking the token", async () => {
        let message = "";

        try {
            await postMessage({ token: slackToken, channel: "C-does-not-exist", text: "no" });
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }

        expect(message).not.toBe("");
        expect(message.includes(slackToken)).toBe(false);
    });
});
