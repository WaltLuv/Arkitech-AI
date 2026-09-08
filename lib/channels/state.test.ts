import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signState, verifyState } from "@/lib/channels/state";

const original = process.env.CHANNEL_SECRET_KEY;

beforeEach(() => {
    process.env.CHANNEL_SECRET_KEY = Buffer.alloc(32, 5).toString("base64");
});

afterEach(() => {
    process.env.CHANNEL_SECRET_KEY = original;
    vi.useRealTimers();
});

describe("Slack install state", () => {
    it("round-trips the account and team member that started the install", () => {
        const state = signState({ userEmail: "owner@example.com", agentId: "agent-1" });

        expect(verifyState(state)).toMatchObject({
            userEmail: "owner@example.com",
            agentId: "agent-1",
        });
    });

    it("refuses a forged state naming a different account", () => {
        // Without the signature, anyone could attach a workspace to any account.
        const forged = Buffer.from(
            JSON.stringify({ userEmail: "victim@example.com", agentId: "agent-1", issuedAt: Date.now() }),
        ).toString("base64url");

        expect(verifyState(`${forged}.not-a-real-signature`)).toBeNull();
    });

    it("refuses a state whose payload was edited after signing", () => {
        const state = signState({ userEmail: "owner@example.com", agentId: "agent-1" });
        const [, signature] = state.split(".");

        const swapped = Buffer.from(
            JSON.stringify({ userEmail: "attacker@example.com", agentId: "agent-1", issuedAt: Date.now() }),
        ).toString("base64url");

        expect(verifyState(`${swapped}.${signature}`)).toBeNull();
    });

    it("refuses a state signed with a different key", () => {
        const state = signState({ userEmail: "owner@example.com", agentId: "agent-1" });

        process.env.CHANNEL_SECRET_KEY = Buffer.alloc(32, 6).toString("base64");

        expect(verifyState(state)).toBeNull();
    });

    it("refuses a state kept past its expiry", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

        const state = signState({ userEmail: "owner@example.com", agentId: "agent-1" });

        vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));

        expect(verifyState(state)).toBeNull();
    });

    it("accepts one still inside its window", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

        const state = signState({ userEmail: "owner@example.com", agentId: "agent-1" });

        vi.setSystemTime(new Date("2026-01-01T00:09:00Z"));

        expect(verifyState(state)).not.toBeNull();
    });

    it("refuses nothing at all", () => {
        expect(verifyState(null)).toBeNull();
        expect(verifyState("")).toBeNull();
        expect(verifyState("no-dot")).toBeNull();
    });
});
