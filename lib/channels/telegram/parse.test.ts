import { describe, expect, it } from "vitest";

import { parseTelegramUpdate } from "@/lib/channels/telegram/parse";

const base = {
    update_id: 42,
    message: {
        message_id: 7,
        from: { id: 900, is_bot: false },
        chat: { id: 900, type: "private" },
        text: "Find me five suppliers",
    },
};

describe("parseTelegramUpdate", () => {
    it("reads an ordinary private message", () => {
        expect(parseTelegramUpdate(base)).toEqual({
            provider: "telegram",
            externalEventId: "42",
            externalChatId: "900",
            externalUserId: "900",
            chatKind: "private",
            externalMessageId: "7",
            text: "Find me five suppliers",
            linkCode: null,
            unsupportedKind: null,
        });
    });

    it("carries update_id through as the dedup key", () => {
        // Telegram reuses update_id when it re-delivers, which is what makes
        // deduplication possible at all.
        expect(parseTelegramUpdate(base)?.externalEventId).toBe("42");
    });

    it("pulls a link code out of a deep-link start", () => {
        const parsed = parseTelegramUpdate({
            ...base,
            message: { ...base.message, text: "/start abc123XYZ_-" },
        });

        expect(parsed?.linkCode).toBe("abc123XYZ_-");
        // A start is a handshake, not something to answer.
        expect(parsed?.text).toBeNull();
    });

    it("treats a bare /start as a greeting with no code", () => {
        const parsed = parseTelegramUpdate({ ...base, message: { ...base.message, text: "/start" } });

        expect(parsed?.linkCode).toBeNull();
        expect(parsed?.text).toBeNull();
    });

    it("ignores messages from bots, including its own", () => {
        expect(
            parseTelegramUpdate({
                ...base,
                message: { ...base.message, from: { id: 5, is_bot: true } },
            }),
        ).toBeNull();
    });

    it("recognises a group chat rather than mistaking it for a private one", () => {
        const parsed = parseTelegramUpdate({
            ...base,
            message: { ...base.message, chat: { id: -100, type: "supergroup" } },
        });

        expect(parsed?.chatKind).toBe("group");
    });

    it("recognises a channel post", () => {
        const parsed = parseTelegramUpdate({
            ...base,
            message: { ...base.message, chat: { id: -200, type: "channel" } },
        });

        expect(parsed?.chatKind).toBe("channel");
    });

    it("names an attachment it cannot read instead of dropping it", () => {
        const parsed = parseTelegramUpdate({
            ...base,
            message: { message_id: 8, from: base.message.from, chat: base.message.chat, photo: [{}] },
        });

        expect(parsed?.unsupportedKind).toBe("photo");
        expect(parsed?.text).toBeNull();
    });

    it("prefers a caption over reporting the attachment as unreadable", () => {
        const parsed = parseTelegramUpdate({
            ...base,
            message: { ...base.message, text: undefined, caption: "look at this", photo: [{}] },
        });

        expect(parsed?.text).toBe("look at this");
        expect(parsed?.unsupportedKind).toBeNull();
    });

    it("returns null for an update with no message", () => {
        expect(parseTelegramUpdate({ update_id: 1 })).toBeNull();
    });

    it("returns null rather than throwing on an unfamiliar shape", () => {
        // A webhook that throws is a webhook Telegram retries forever.
        expect(parseTelegramUpdate({} as never)).toBeNull();
        expect(parseTelegramUpdate({ update_id: 3, message: { chat: {} } } as never)).toBeNull();
    });
});
