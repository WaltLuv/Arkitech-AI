import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The inbound pipeline is where a stranger with a bot's public username is
 * turned away, and where a provider's retry is stopped from spending a second
 * Usage Credit. These tests are about that order, so the pieces it calls are
 * mocked and what is asserted is which of them ran.
 */
const mocks = vi.hoisted(() => ({
    claimInboundEvent: vi.fn(),
    recordMessage: vi.fn(),
    createChannelConversation: vi.fn(),
    redeemLinkCode: vi.fn(),
    send: vi.fn(),
    selectResults: [] as unknown[][],
    inserted: [] as { table: string; values: unknown }[],
    updated: [] as { table: string; values: unknown }[],
    deleted: [] as string[],
}));

/** A drizzle-shaped fake: chains that end in a queued result. */
function thenable<T>(value: T) {
    const promise = Promise.resolve(value) as Promise<T> & {
        onConflictDoNothing: () => Promise<T>;
        returning: () => Promise<T>;
    };
    promise.onConflictDoNothing = () => Promise.resolve(value);
    promise.returning = () => Promise.resolve(value);
    return promise;
}

vi.mock("@/db", () => {
    const table = (name: string) =>
        new Proxy({ __name: name }, { get: (t, k) => (k === "__name" ? name : `${name}.${String(k)}`) });

    return {
        db: {
            select: () => ({
                from: () => ({
                    where: () => ({
                        limit: () => Promise.resolve(mocks.selectResults.shift() ?? []),
                    }),
                }),
            }),
            insert: (t: { __name: string }) => ({
                values: (values: unknown) => {
                    mocks.inserted.push({ table: t.__name, values });
                    return thenable([values]);
                },
            }),
            update: (t: { __name: string }) => ({
                set: (values: unknown) => ({
                    where: () => {
                        mocks.updated.push({ table: t.__name, values });
                        return thenable([values]);
                    },
                }),
            }),
            delete: (t: { __name: string }) => ({
                where: () => {
                    mocks.deleted.push(t.__name);
                    return thenable([]);
                },
            }),
        },
        channelThread: table("channelThread"),
        channelConnection: table("channelConnection"),
        conversation: table("conversation"),
        message: table("message"),
        channelInboundEvent: table("channelInboundEvent"),
    };
});

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ op: "and", c }),
    eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
}));

vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));

vi.mock("@/lib/channels/dedup", () => ({ claimInboundEvent: mocks.claimInboundEvent }));

vi.mock("@/lib/channels/conversations", () => ({
    recordMessage: mocks.recordMessage,
    createChannelConversation: mocks.createChannelConversation,
}));

vi.mock("@/lib/channels/linking", () => ({ redeemLinkCode: mocks.redeemLinkCode }));

import { receiveInboundMessage, UNLINKED_REPLY } from "@/lib/channels/inbound";
import type { InboundMessage } from "@/lib/channels/types";

const connection = (over: Record<string, unknown> = {}) =>
    ({
        id: "conn-1",
        userEmail: "owner@example.com",
        provider: "telegram",
        status: "active",
        defaultAgentId: "agent-1",
        authorizedExternalUserId: null,
        ...over,
    }) as never;

const inbound = (over: Partial<InboundMessage> = {}): InboundMessage => ({
    provider: "telegram",
    externalEventId: "42",
    externalChatId: "900",
    externalUserId: "900",
    chatKind: "private",
    externalMessageId: "7",
    text: "do the thing",
    linkCode: null,
    unsupportedKind: null,
    ...over,
});

const linkedThread = (over: Record<string, unknown> = {}) => ({
    id: "thread-1",
    conversationId: "conv-1",
    connectionId: "conn-1",
    userEmail: "owner@example.com",
    externalChatId: "900",
    externalUserId: "900",
    status: "active",
    ...over,
});

const ownedConversation = { id: "conv-1", userEmail: "owner@example.com", agentId: "agent-1" };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    mocks.deleted.length = 0;

    mocks.claimInboundEvent.mockResolvedValue(true);
    mocks.recordMessage.mockResolvedValue({ id: "msg-1", createdAt: new Date() });
    mocks.createChannelConversation.mockResolvedValue({ id: "conv-new" });
    mocks.send.mockResolvedValue(undefined);
});

describe("deduplication", () => {
    it("queues an agent turn for a first delivery", async () => {
        mocks.selectResults.push([linkedThread()], [ownedConversation]);

        const result = await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(result).toMatchObject({ outcome: "queued", conversationId: "conv-1" });
        expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it("does nothing at all for a retry of the same delivery", async () => {
        mocks.claimInboundEvent.mockResolvedValue(false);

        const result = await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(result).toEqual({ outcome: "duplicate" });
        // No Agent turn, so no second Usage Credit and no second reply.
        expect(mocks.send).not.toHaveBeenCalled();
        expect(mocks.recordMessage).not.toHaveBeenCalled();
    });

    it("claims before it looks anything up", async () => {
        // If authorisation ran first, a retry would still reach the database
        // and, worse, any side effect placed before the claim.
        mocks.claimInboundEvent.mockResolvedValue(false);

        await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(mocks.claimInboundEvent).toHaveBeenCalledTimes(1);
    });

    it("undoes the arrival when the turn could not be queued", async () => {
        mocks.selectResults.push([linkedThread()], [ownedConversation]);
        mocks.send.mockRejectedValue(new Error("inngest down"));

        await expect(
            receiveInboundMessage({ connection: connection(), inbound: inbound() }),
        ).rejects.toThrow();

        // Both the message and the claim go, so the provider's own retry is
        // processed rather than deduplicated into silence.
        expect(mocks.deleted).toContain("message");
        expect(mocks.deleted).toContain("channelInboundEvent");
    });
});

describe("authorisation", () => {
    it("refuses a chat nobody linked", async () => {
        mocks.selectResults.push([]);

        const result = await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(result).toMatchObject({ outcome: "refused", reason: "not_linked", reply: UNLINKED_REPLY });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("refuses a chat whose link was revoked", async () => {
        mocks.selectResults.push([linkedThread({ status: "revoked" })]);

        const result = await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(result).toMatchObject({ outcome: "refused", reason: "link_revoked" });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("refuses a different person messaging on a linked chat", async () => {
        mocks.selectResults.push([linkedThread({ externalUserId: "111" })]);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ externalUserId: "999" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "unauthorized_user" });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("refuses a group chat even when the thread is linked", async () => {
        mocks.selectResults.push([linkedThread()]);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ chatKind: "group" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "group_unsupported" });
    });

    it("refuses everything on a disconnected connection", async () => {
        const result = await receiveInboundMessage({
            connection: connection({ status: "disconnected" }),
            inbound: inbound(),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "connection_disconnected" });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("refuses a conversation that does not belong to the connection's owner", async () => {
        // The owner is in the predicate, so a mismatch returns no row at all.
        mocks.selectResults.push([linkedThread()], []);

        const result = await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(result).toMatchObject({ outcome: "refused", reason: "conversation_missing" });
        expect(mocks.send).not.toHaveBeenCalled();
    });
});

describe("linking", () => {
    it("links a chat when a valid code is presented", async () => {
        mocks.redeemLinkCode.mockResolvedValue({
            connectionId: "conn-1",
            userEmail: "owner@example.com",
        });
        mocks.selectResults.push([]);

        const result = await receiveInboundMessage({
            connection: connection({ status: "pending_link" }),
            inbound: inbound({ linkCode: "code-1", text: null }),
        });

        expect(result.outcome).toBe("linked");
        expect(mocks.inserted.some(row => row.table === "channelThread")).toBe(true);
    });

    it("starts the connection serving once a chat links", async () => {
        // Without this the chat links and every message after it is refused by
        // the status check, silently.
        mocks.redeemLinkCode.mockResolvedValue({
            connectionId: "conn-1",
            userEmail: "owner@example.com",
        });
        mocks.selectResults.push([]);

        await receiveInboundMessage({
            connection: connection({ status: "pending_link" }),
            inbound: inbound({ linkCode: "code-1", text: null }),
        });

        expect(
            mocks.updated.some(
                row =>
                    row.table === "channelConnection" &&
                    (row.values as { status?: string }).status === "active",
            ),
        ).toBe(true);
    });

    it("keeps serving a message sent straight after linking", async () => {
        // The pass that links and the pass that answers are different
        // deliveries; the second must not meet a pending_link connection.
        mocks.redeemLinkCode.mockResolvedValue({
            connectionId: "conn-1",
            userEmail: "owner@example.com",
        });
        mocks.selectResults.push([]);

        await receiveInboundMessage({
            connection: connection({ status: "pending_link" }),
            inbound: inbound({ linkCode: "code-1", text: null }),
        });

        mocks.selectResults.push([linkedThread()], [ownedConversation]);

        const next = await receiveInboundMessage({
            connection: connection({ status: "active" }),
            inbound: inbound({ externalEventId: "43", text: "now do the thing" }),
        });

        expect(next.outcome).toBe("queued");
    });

    it("refuses a code issued for a different connection", async () => {
        // Redemption succeeding is not enough: the code must be this bot's.
        mocks.redeemLinkCode.mockResolvedValue({
            connectionId: "conn-other",
            userEmail: "someone@example.com",
        });

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ linkCode: "code-1" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "invalid_link_code" });
        expect(mocks.inserted).toHaveLength(0);
    });

    it("refuses an expired or already used code", async () => {
        mocks.redeemLinkCode.mockResolvedValue(null);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ linkCode: "code-1" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "invalid_link_code" });
    });

    it("refuses to link a group chat", async () => {
        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ linkCode: "code-1", chatKind: "group" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "group_unsupported" });
        expect(mocks.redeemLinkCode).not.toHaveBeenCalled();
    });

    it("re-points an existing chat rather than duplicating it", async () => {
        mocks.redeemLinkCode.mockResolvedValue({
            connectionId: "conn-1",
            userEmail: "owner@example.com",
        });
        mocks.selectResults.push([linkedThread({ status: "revoked" })]);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ linkCode: "code-1" }),
        });

        expect(result.outcome).toBe("linked");
        expect(mocks.updated.some(row => row.table === "channelThread")).toBe(true);
        expect(mocks.inserted.some(row => row.table === "channelThread")).toBe(false);
    });
});

describe("pre-authorised connections", () => {
    it("opens a conversation for the person who installed the app", async () => {
        // Slack: no thread yet, but the installer is known from OAuth. The
        // second lookup finds the thread the auto-link just wrote.
        mocks.selectResults.push([], [linkedThread({ externalUserId: "U789" })], [ownedConversation]);

        const result = await receiveInboundMessage({
            connection: connection({ provider: "slack", authorizedExternalUserId: "U789" }),
            inbound: inbound({ provider: "slack", externalUserId: "U789" }),
        });

        expect(result.outcome).toBe("queued");
        expect(mocks.inserted.some(row => row.table === "channelThread")).toBe(true);
    });

    it("refuses a colleague in the same workspace", async () => {
        mocks.selectResults.push([]);

        const result = await receiveInboundMessage({
            connection: connection({ provider: "slack", authorizedExternalUserId: "U789" }),
            inbound: inbound({ provider: "slack", externalUserId: "U-someone-else" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "not_linked" });
        expect(mocks.inserted).toHaveLength(0);
    });

    it("refuses rather than looping when the opened thread cannot be seen", async () => {
        // Both lookups come back empty. The second pass must give up.
        mocks.selectResults.push([], []);

        const result = await receiveInboundMessage({
            connection: connection({ provider: "slack", authorizedExternalUserId: "U789" }),
            inbound: inbound({ provider: "slack", externalUserId: "U789" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "not_linked" });
    });

    it("does not auto-open a group conversation", async () => {
        mocks.selectResults.push([]);

        const result = await receiveInboundMessage({
            connection: connection({ provider: "slack", authorizedExternalUserId: "U789" }),
            inbound: inbound({ provider: "slack", externalUserId: "U789", chatKind: "group" }),
        });

        expect(result).toMatchObject({ outcome: "refused", reason: "not_linked" });
    });
});

describe("message handling", () => {
    it("ignores an empty message without spending anything", async () => {
        mocks.selectResults.push([linkedThread()], [ownedConversation]);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ text: "   " }),
        });

        expect(result).toMatchObject({ outcome: "ignored" });
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("answers an unsupported attachment in words rather than failing", async () => {
        mocks.selectResults.push([linkedThread()]);

        const result = await receiveInboundMessage({
            connection: connection(),
            inbound: inbound({ text: null, unsupportedKind: "photo" }),
        });

        expect(result).toMatchObject({ outcome: "refused" });
        expect((result as { reply?: string }).reply).toContain("photo");
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("stores the arrival before handing it on", async () => {
        mocks.selectResults.push([linkedThread()], [ownedConversation]);

        await receiveInboundMessage({ connection: connection(), inbound: inbound() });

        expect(mocks.recordMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                conversationId: "conv-1",
                userEmail: "owner@example.com",
                direction: "inbound",
                senderKind: "user",
                body: "do the thing",
            }),
        );
    });
});
