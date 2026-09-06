import { describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@/db", () => ({
    db: { select },
    AgentConfig: { agentId: "agentId", userEmail: "userEmail" },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ op: "and", c }),
    eq: (col: unknown, v: unknown) => ({ op: "eq", col, v }),
}));

import {
    loadOwnedAgent,
    resolveOwnership,
    type OwnedAgent,
} from "@/lib/agent-ownership";

const agent = (userEmail: string | null) =>
    ({ agentId: "ag-1", userEmail }) as OwnedAgent;

describe("resolveOwnership", () => {
    it("accepts the owner", () => {
        const result = resolveOwnership(agent("me@example.com"), "me@example.com");

        expect(result.ok).toBe(true);
    });

    it("refuses someone else's Agent", () => {
        const result = resolveOwnership(agent("them@example.com"), "me@example.com");

        expect(result).toMatchObject({ ok: false, status: 404 });
    });

    it("refuses an Agent that does not exist", () => {
        expect(resolveOwnership(undefined, "me@example.com")).toMatchObject({ ok: false });
    });

    it("gives an unowned Agent and a missing one the same answer", () => {
        // Distinguishing them tells an attacker which agent ids are real.
        const notMine = resolveOwnership(agent("them@example.com"), "me@example.com");
        const missing = resolveOwnership(undefined, "me@example.com");

        expect(notMine).toEqual(missing);
    });

    it("refuses when the caller is not signed in", () => {
        expect(resolveOwnership(agent("them@example.com"), "")).toMatchObject({ ok: false });
    });

    it("refuses an Agent with no owner recorded", () => {
        expect(resolveOwnership(agent(null), "me@example.com")).toMatchObject({ ok: false });
    });
});

describe("loadOwnedAgent", () => {
    const queryReturning = (rows: OwnedAgent[]) => {
        const where = vi.fn(async (_condition?: unknown) => rows);
        const from = vi.fn(() => ({ where }));
        select.mockReturnValue({ from });
        return { from, where };
    };

    it("scopes the query by owner, so another user's row never leaves the database", async () => {
        const { where } = queryReturning([agent("me@example.com")]);

        await loadOwnedAgent("ag-1", "me@example.com");

        expect(JSON.stringify(where.mock.calls[0]?.[0] ?? {})).toContain("me@example.com");
    });

    it("refuses without querying when no agentId is given", async () => {
        select.mockClear();

        const result = await loadOwnedAgent(null, "me@example.com");

        expect(result.ok).toBe(false);
        expect(select).not.toHaveBeenCalled();
    });

    it("refuses without querying when the caller is anonymous", async () => {
        select.mockClear();

        const result = await loadOwnedAgent("ag-1", "");

        expect(result.ok).toBe(false);
        expect(select).not.toHaveBeenCalled();
    });

    it("returns not found when the scoped query matches nothing", async () => {
        queryReturning([]);

        await expect(loadOwnedAgent("ag-1", "me@example.com")).resolves.toMatchObject({
            ok: false,
            status: 404,
        });
    });
});
