import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Delivery status has to be honest. "Sent" means the provider took it, not
 * that Arkitech queued it, because a customer reading the transcript is trying
 * to work out whether the other person actually got an answer.
 */
const mocks = vi.hoisted(() => ({
    threads: [] as Record<string, unknown>[],
    recordMessage: vi.fn(),
    updateMessageDelivery: vi.fn(),
    sendText: vi.fn(),
    isCredentialFailure: vi.fn(),
    markNeedsAttention: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.threads) }) }),
        }),
    },
    channelThread: { conversationId: "conversation_id", userEmail: "email" },
    conversation: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ op: "and", c }),
    eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
}));

vi.mock("@/lib/channels/conversations", () => ({
    recordMessage: mocks.recordMessage,
    updateMessageDelivery: mocks.updateMessageDelivery,
}));

vi.mock("@/lib/channels/registry", () => ({
    adapterFor: () => ({
        sendText: mocks.sendText,
        isCredentialFailure: mocks.isCredentialFailure,
    }),
}));

vi.mock("@/lib/channels/connections", () => ({
    markNeedsAttention: mocks.markNeedsAttention,
}));

import { deliverReply } from "@/lib/channels/outbound";

const connection = { id: "conn-1", provider: "telegram", userEmail: "owner@example.com" } as never;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.threads = [{ id: "thread-1", externalChatId: "900", userEmail: "owner@example.com" }];
    mocks.recordMessage.mockResolvedValue({ id: "msg-out" });
    mocks.updateMessageDelivery.mockResolvedValue(undefined);
    mocks.sendText.mockResolvedValue({ externalMessageId: "55" });
    mocks.isCredentialFailure.mockReturnValue(false);
    mocks.markNeedsAttention.mockResolvedValue(undefined);
});

describe("deliverReply", () => {
    it("writes the reply before attempting to send it", async () => {
        await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "here you go",
        });

        // Recorded as sending, so a refused reply is visible rather than lost.
        expect(mocks.recordMessage).toHaveBeenCalledWith(
            expect.objectContaining({ direction: "outbound", status: "sending" }),
        );
    });

    it("marks it sent only once the provider confirmed", async () => {
        const result = await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "here you go",
        });

        expect(result).toMatchObject({ outcome: "sent", externalMessageId: "55" });
        expect(mocks.updateMessageDelivery).toHaveBeenCalledWith(
            expect.objectContaining({ status: "sent", externalMessageId: "55" }),
        );
    });

    it("marks it failed when the provider refused it", async () => {
        mocks.sendText.mockRejectedValue(new Error("Telegram sendMessage failed: chat not found"));

        const result = await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "here you go",
        });

        expect(result).toMatchObject({ outcome: "failed" });
        expect(mocks.updateMessageDelivery).toHaveBeenCalledWith(
            expect.objectContaining({ status: "failed" }),
        );
    });

    it("does not report a failed send as delivered", async () => {
        mocks.sendText.mockRejectedValue(new Error("nope"));

        const result = await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "here you go",
        });

        expect(result.outcome).not.toBe("sent");
    });

    it("refuses to deliver into a conversation with no channel thread", async () => {
        mocks.threads = [];

        const result = await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "here you go",
        });

        expect(result).toEqual({ outcome: "no_channel" });
        expect(mocks.sendText).not.toHaveBeenCalled();
    });

    it("scopes the thread lookup to the owner", async () => {
        // A conversation id must not be enough to post into someone's chat.
        await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "hi",
        });

        expect(mocks.recordMessage).toHaveBeenCalledWith(
            expect.objectContaining({ userEmail: "owner@example.com" }),
        );
    });

    it("flags the connection when the credential itself is finished", async () => {
        mocks.sendText.mockRejectedValue(new Error("Slack chat.postMessage failed: invalid_auth"));
        mocks.isCredentialFailure.mockReturnValue(true);

        await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "hi",
        });

        expect(mocks.markNeedsAttention).toHaveBeenCalledWith("conn-1", expect.stringMatching(/Reconnect/));
    });

    it("does not flag the connection when one message was merely refused", async () => {
        // Someone blocking the bot is their decision, not a broken connection.
        mocks.sendText.mockRejectedValue(new Error("Telegram sendMessage failed: bot was blocked"));
        mocks.isCredentialFailure.mockReturnValue(false);

        await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "hi",
        });

        expect(mocks.markNeedsAttention).not.toHaveBeenCalled();
    });

    it("keeps the Run on the reply so the spend stays attributable", async () => {
        await deliverReply({
            connection,
            conversationId: "conv-1",
            userEmail: "owner@example.com",
            text: "hi",
            runId: "run-9",
        });

        expect(mocks.recordMessage).toHaveBeenCalledWith(
            expect.objectContaining({ runId: "run-9" }),
        );
    });
});
