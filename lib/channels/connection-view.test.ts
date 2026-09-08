import { describe, expect, it } from "vitest";

import { toConnectionView } from "@/lib/channels/connection-view";

const connection = (over: Record<string, unknown> = {}) =>
    ({
        id: "conn-1",
        userEmail: "owner@example.com",
        provider: "telegram",
        status: "active",
        defaultAgentId: "agent-1",
        externalAccountId: "123456789",
        externalAccountLabel: "@AcmeBot",
        secret: "v1.aaa.bbb.ccc-this-is-the-sealed-bot-token",
        authorizedExternalUserId: "U789",
        statusReason: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        ...over,
    }) as never;

describe("toConnectionView", () => {
    it("never carries the sealed credential", () => {
        const view = toConnectionView(connection());

        expect(JSON.stringify(view)).not.toContain("sealed-bot-token");
        expect(view).not.toHaveProperty("secret");
    });

    it("returns only the fields it names", () => {
        // Built as an allow-list, so a column added later cannot leak by
        // default. This test is what makes that promise hold.
        expect(Object.keys(toConnectionView(connection())).sort()).toEqual([
            "accountLabel",
            "agentId",
            "attention",
            "id",
            "provider",
            "state",
            "updatedAt",
        ]);
    });

    it("does not expose the provider's account id", () => {
        // A Telegram bot id or a Slack team id is of no use to the person and
        // is one more thing to correlate an account by.
        const view = toConnectionView(connection());

        expect(JSON.stringify(view)).not.toContain("123456789");
    });

    it("does not expose the authorised external user", () => {
        expect(JSON.stringify(toConnectionView(connection()))).not.toContain("U789");
    });

    it("says connected in words rather than in a status code", () => {
        expect(toConnectionView(connection()).state).toBe("connected");
        expect(toConnectionView(connection({ status: "pending_link" })).state).toBe("finish_connecting");
        expect(toConnectionView(connection({ status: "disconnected" })).state).toBe("not_connected");
    });

    it("shows an attention reason only when there is one", () => {
        expect(toConnectionView(connection()).attention).toBeNull();

        expect(
            toConnectionView(
                connection({ status: "needs_attention", statusReason: "Telegram stopped accepting messages." }),
            ).attention,
        ).toBe("Telegram stopped accepting messages.");
    });

    it("treats an unrecognised status as needing attention rather than as working", () => {
        expect(toConnectionView(connection({ status: "something_new" })).state).toBe("needs_attention");
    });
});
