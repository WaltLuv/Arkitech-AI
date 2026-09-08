import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook is the front door. Anyone can find the URL, so what stands
 * between a stranger and an Agent is the secret token Telegram sends back and
 * nothing else.
 */
const mocks = vi.hoisted(() => ({
    connection: null as Record<string, unknown> | null,
    receiveInboundMessage: vi.fn(),
    sendChannelNotice: vi.fn(),
    telegramCredentials: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: () => Promise.resolve(mocks.connection ? [mocks.connection] : []) }),
            }),
        }),
    },
    channelConnection: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({ eq: (col: unknown, v: unknown) => ({ col, v }) }));

vi.mock("@/lib/channels/inbound", () => ({
    receiveInboundMessage: mocks.receiveInboundMessage,
}));

vi.mock("@/lib/channels/outbound", () => ({ sendChannelNotice: mocks.sendChannelNotice }));

vi.mock("@/lib/channels/telegram/adapter", () => ({
    telegramCredentials: mocks.telegramCredentials,
}));

import { POST } from "./route";

const SECRET = "the-registered-webhook-secret";

const update = {
    update_id: 1,
    message: {
        message_id: 5,
        from: { id: 900, is_bot: false },
        chat: { id: 900, type: "private" },
        text: "hello",
    },
};

function request(secret: string | null, body: unknown = update) {
    return new Request("https://arkitech.example/api/channels/telegram/webhook/conn-1", {
        method: "POST",
        headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {},
        body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest;
}

const context = { params: Promise.resolve({ connectionId: "conn-1" }) };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection = { id: "conn-1", provider: "telegram", status: "active", secret: "sealed" };
    mocks.telegramCredentials.mockReturnValue({ botToken: "t", webhookSecret: SECRET });
    mocks.receiveInboundMessage.mockResolvedValue({ outcome: "queued" });
    mocks.sendChannelNotice.mockResolvedValue(undefined);
});

describe("POST /api/channels/telegram/webhook/[connectionId]", () => {
    it("accepts a request carrying the registered secret", async () => {
        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(200);
        expect(mocks.receiveInboundMessage).toHaveBeenCalledTimes(1);
    });

    it("refuses a request with no secret header", async () => {
        const response = await POST(request(null), context);

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses a request with the wrong secret", async () => {
        const response = await POST(request("not-the-secret"), context);

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses a secret that is merely a prefix of the real one", async () => {
        const response = await POST(request(SECRET.slice(0, 10)), context);

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses when the connection does not exist", async () => {
        mocks.connection = null;

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(403);
    });

    it("gives a missing connection and a bad secret the same answer", async () => {
        // Otherwise the response says which connection ids are real.
        mocks.connection = null;
        const missing = await POST(request(SECRET), context);

        mocks.connection = { id: "conn-1", provider: "telegram", status: "active", secret: "sealed" };
        const wrongSecret = await POST(request("nope"), context);

        expect(missing.status).toBe(wrongSecret.status);
        expect(await missing.json()).toEqual(await wrongSecret.json());
    });

    it("refuses when a connection's credentials cannot be opened", async () => {
        mocks.telegramCredentials.mockImplementation(() => {
            throw new Error("bad envelope");
        });

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses a connection belonging to another provider", async () => {
        mocks.connection = { id: "conn-1", provider: "slack", status: "active", secret: "sealed" };

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(403);
    });

    it("acknowledges an update type it does not act on", async () => {
        // A non-200 makes Telegram offer the same update again, forever.
        const response = await POST(request(SECRET, { update_id: 2 }), context);

        expect(response.status).toBe(200);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("acknowledges a duplicate rather than asking for another retry", async () => {
        mocks.receiveInboundMessage.mockResolvedValue({ outcome: "duplicate" });

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(200);
        expect(mocks.sendChannelNotice).not.toHaveBeenCalled();
    });

    it("answers a refusal in the chat and still returns 200", async () => {
        mocks.receiveInboundMessage.mockResolvedValue({
            outcome: "refused",
            reason: "not_linked",
            reply: "not connected",
        });

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(200);
        expect(mocks.sendChannelNotice).toHaveBeenCalledWith(
            expect.objectContaining({ text: "not connected" }),
        );
    });

    it("stays 200 when the refusal itself cannot be delivered", async () => {
        mocks.receiveInboundMessage.mockResolvedValue({
            outcome: "refused",
            reason: "not_linked",
            reply: "not connected",
        });
        mocks.sendChannelNotice.mockRejectedValue(new Error("telegram down"));

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(200);
    });

    it("asks for a retry when the pipeline could not finish", async () => {
        mocks.receiveInboundMessage.mockRejectedValue(new Error("database down"));

        const response = await POST(request(SECRET), context);

        expect(response.status).toBe(500);
    });
});
