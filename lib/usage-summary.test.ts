import { describe, expect, it } from "vitest";
import { summariseUsage, type LedgerRow } from "@/lib/usage-summary";

const at = (iso: string) => new Date(iso);

const row = (over: Partial<LedgerRow>): LedgerRow => ({
    agentId: "ag-1",
    amount: 1,
    direction: "debit",
    reason: "run_accepted",
    createdAt: at("2026-09-01T12:00:00Z"),
    ...over,
});

describe("summariseUsage", () => {
    it("counts a charge as spend against its Agent", () => {
        const summary = summariseUsage([row({})]);

        expect(summary.perAgent).toEqual([
            { agentId: "ag-1", spent: 1, refunded: 0, net: 1 },
        ]);
    });

    it("nets a refund against the charge, so a refunded Run costs nothing", () => {
        const summary = summariseUsage([
            row({}),
            row({ direction: "credit", reason: "worker_failure" }),
        ]);

        expect(summary.perAgent[0]).toMatchObject({ spent: 1, refunded: 1, net: 0 });
        expect(summary.totalNet).toBe(0);
    });

    it("keeps per-Agent totals summing to the account total", () => {
        const summary = summariseUsage([
            row({ agentId: "ag-1" }),
            row({ agentId: "ag-2" }),
            row({ agentId: "ag-2" }),
        ]);

        const sum = summary.perAgent.reduce((n, a) => n + a.net, 0);
        expect(sum).toBe(summary.totalNet);
        expect(summary.totalNet).toBe(3);
    });

    it("never attributes the opening balance to an Agent", () => {
        // It belongs to no Agent and no Run. Attributing it would invent history.
        const summary = summariseUsage([
            row({ agentId: null, direction: "credit", reason: "opening_balance", amount: 100 }),
            row({}),
        ]);

        expect(summary.perAgent).toHaveLength(1);
        expect(summary.systemCredits).toBe(100);
        expect(summary.totalNet).toBe(1);
    });

    it("still reports spend for an Agent that was deleted", () => {
        // History does not vanish when a user cleans up.
        const summary = summariseUsage([row({ agentId: "deleted-agent" })]);

        expect(summary.perAgent[0].agentId).toBe("deleted-agent");
    });

    it("honours a date range at both ends", () => {
        const rows = [
            row({ createdAt: at("2026-08-01T00:00:00Z") }),
            row({ createdAt: at("2026-09-01T00:00:00Z") }),
            row({ createdAt: at("2026-10-01T00:00:00Z") }),
        ];

        const summary = summariseUsage(rows, {
            from: at("2026-08-15T00:00:00Z"),
            to: at("2026-09-15T00:00:00Z"),
        });

        expect(summary.totalNet).toBe(1);
    });

    it("accepts timestamps as strings, which is how JSON delivers them", () => {
        const summary = summariseUsage([row({ createdAt: "2026-09-01T12:00:00Z" })]);

        expect(summary.totalNet).toBe(1);
    });

    it("orders by net spend, with a stable tie-break", () => {
        const summary = summariseUsage([
            row({ agentId: "b" }),
            row({ agentId: "a" }),
            row({ agentId: "c" }),
            row({ agentId: "c" }),
        ]);

        expect(summary.perAgent.map(a => a.agentId)).toEqual(["c", "a", "b"]);
    });

    it("returns an empty summary for no rows rather than throwing", () => {
        expect(summariseUsage([])).toEqual({ perAgent: [], totalNet: 0, systemCredits: 0 });
    });
});
