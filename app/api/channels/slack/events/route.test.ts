import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

/**
 * One endpoint serves every Slack install, so which customer an event belongs
 * to is decided entirely by the verified payload. These cover both halves: that
 * an unsigned or missigned request never gets that far, and that a signed one
 * resolves to the right connection or to none at all.
 */
const mocks = vi.hoisted(() => ({
    connections: [] as Record<string, unknown>[],
    lastWhere: null as unknown,
    receiveInboundMessage: vi.fn(),
    sendChannelNotice: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: (clause: unknown) => {
                    mocks.lastWhere = clause;
                    return { limit: () => Promise.resolve(mocks.connections) };
                },
            }),
        }),
    },
    channelConnection: { provider: "provider", externalAccountId: "external_account_id" },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ op: "and", c }),
    eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
}));

vi.mock("@/lib/channels/inbound", () => ({ receiveInboundMessage: mocks.receiveInboundMessage }));
vi.mock("@/lib/channels/outbound", () => ({ sendChannelNotice: mocks.sendChannelNotice }));

import { POST } from "./route";

const SECRET = "slack-signing-secret";

const event = {
    type: "event_callback",
    team_id: "T123",
    event_id: "Ev1",
    event: {
        type: "message",
        channel: "D1",
        channel_type: "im",
        user: "U789",
        text: "hello",
        ts: "1700000000.0001",
    },
};

function request(payload: unknown, options: { secret?: string; timestamp?: number; signature?: string } = {}) {
    const body = JSON.stringify(payload);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const signature =
        options.signature ??
        `v0=${createHmac("sha256", options.secret ?? SECRET).update(`v0:${timestamp}:${body}`).digest("hex")}`;

    return new Request("https://arkitech.example/api/channels/slack/events", {
        method: "POST",
        headers: {
            "x-slack-signature": signature,
            "x-slack-request-timestamp": String(timestamp),
        },
        body,
    }) as unknown as import("next/server").NextRequest;
}

/** Every eq() clause in the where tree, flattened. */
function clauseValues(clause: unknown): unknown[] {
    if (!clause || typeof clause !== "object") return [];
    const node = clause as { op?: string; c?: unknown[]; v?: unknown };
    if (node.op === "eq") return [node.v];
    if (node.op === "and") return (node.c ?? []).flatMap(clauseValues);
    return [];
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_SIGNING_SECRET = SECRET;
    mocks.connections = [{ id: "conn-1", provider: "slack", status: "active" }];
    mocks.lastWhere = null;
    mocks.receiveInboundMessage.mockResolvedValue({ outcome: "queued" });
    mocks.sendChannelNotice.mockResolvedValue(undefined);
});

describe("POST /api/channels/slack/events", () => {
    it("accepts a correctly signed event", async () => {
        const response = await POST(request(event));

        expect(response.status).toBe(200);
        expect(mocks.receiveInboundMessage).toHaveBeenCalledTimes(1);
    });

    it("refuses an unsigned request", async () => {
        const body = JSON.stringify(event);
        const bare = new Request("https://arkitech.example/api/channels/slack/events", {
            method: "POST",
            body,
        }) as unknown as import("next/server").NextRequest;

        const response = await POST(bare);

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses a request signed with the wrong secret", async () => {
        const response = await POST(request(event, { secret: "attacker-secret" }));

        expect(response.status).toBe(403);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("refuses a replayed request", async () => {
        const old = Math.floor(Date.now() / 1000) - 600;

        const response = await POST(request(event, { timestamp: old }));

        expect(response.status).toBe(403);
    });

    it("refuses everything when the signing secret is not configured", async () => {
        delete process.env.SLACK_SIGNING_SECRET;

        const response = await POST(request(event));

        expect(response.status).toBe(403);
    });

    it("echoes the url_verification challenge, but only when signed", async () => {
        const response = await POST(request({ type: "url_verification", challenge: "c-1" }));

        expect(await response.json()).toEqual({ challenge: "c-1" });
    });

    it("refuses an unsigned url_verification", async () => {
        const response = await POST(request({ type: "url_verification", challenge: "c-1" }, { secret: "wrong" }));

        expect(response.status).toBe(403);
    });

    it("resolves the connection by workspace and sender together", async () => {
        // Keying on the workspace alone would hand one customer's messages to
        // another customer in the same Slack workspace.
        await POST(request(event));

        expect(clauseValues(mocks.lastWhere)).toContain("T123:U789");
    });

    it("acknowledges an event from a workspace it has no connection for", async () => {
        mocks.connections = [];

        const response = await POST(request(event));

        expect(response.status).toBe(200);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("acknowledges the app's own message without acting on it", async () => {
        const echo = { ...event, event: { ...event.event, bot_id: "B1" } };

        const response = await POST(request(echo));

        expect(response.status).toBe(200);
        expect(mocks.receiveInboundMessage).not.toHaveBeenCalled();
    });

    it("asks for a retry when the pipeline could not finish", async () => {
        mocks.receiveInboundMessage.mockRejectedValue(new Error("database down"));

        const response = await POST(request(event));

        expect(response.status).toBe(500);
    });
});
