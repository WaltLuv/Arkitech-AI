import { beforeEach, describe, expect, it, vi } from "vitest";

// One captured SQL execution per call. The interesting assertions are what the
// statement did, so the fake returns rows and records what it was asked.
let rows: Array<{ balance: number }> = [];
let thrown: unknown = null;
type SqlArg = { queryChunks?: unknown[] };

// vi.mock's factory is hoisted above the module body, so the spy has to be
// hoisted with it. Its behaviour is set per test in beforeEach.
const { execute } = vi.hoisted(() => ({
    execute: vi.fn<(query: SqlArg) => Promise<{ rows: Array<{ balance: number }> }>>(),
}));

vi.mock("@/db", () => ({
    db: { execute },
    users: { email: "users.email" },
}));

import {
    CREDIT_COST_BY_EXECUTION_MODE,
    chargeRun,
    creditCostFor,
    refundRun,
} from "@/lib/credits";

const movement = {
    userEmail: "someone@example.com",
    agentId: "ag-1",
    runId: "11111111-2222-3333-4444-555555555555",
    cost: 1,
};

const duplicateKey = Object.assign(new Error("duplicate key"), { code: "23505" });

/** The SQL as written, with bound parameters inlined, for readable assertions. */
const statement = () => {
    const arg: SqlArg = execute.mock.calls[0]?.[0] ?? {};
    return (arg.queryChunks ?? [])
        .map(chunk => {
            if (chunk && typeof chunk === "object" && "value" in chunk) {
                return (chunk as { value: string[] }).value.join("");
            }
            return String(chunk);
        })
        .join("");
};

beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
    thrown = null;
    execute.mockImplementation(async () => {
        if (thrown) throw thrown;
        return { rows };
    });
});

describe("creditCostFor", () => {
    it("prices a standard Run at 1", () => {
        expect(creditCostFor("standard")).toBe(1);
    });

    it("defaults to standard", () => {
        expect(creditCostFor()).toBe(1);
    });

    it("reads the price from configuration rather than assuming it", () => {
        // Nothing may hard-code 1. A future mode is added here, not in the ledger.
        expect(Object.keys(CREDIT_COST_BY_EXECUTION_MODE)).toEqual(["standard"]);
    });
});

describe("chargeRun", () => {
    it("returns the new balance when the charge succeeds", async () => {
        rows = [{ balance: 41 }];

        await expect(chargeRun(movement)).resolves.toEqual({ balance: 41 });
    });

    it("returns null when the user cannot afford it, rather than throwing", async () => {
        // The guard lives in the statement's WHERE clause, so an unaffordable
        // charge simply matches no row and inserts nothing.
        rows = [];

        await expect(chargeRun(movement)).resolves.toBeNull();
    });

    it("treats an already-charged Run as a no-op, not an error", async () => {
        // The unique key aborts the statement, taking the decrement with it.
        // This is what stops a retried queue step charging twice.
        thrown = duplicateKey;

        await expect(chargeRun(movement)).resolves.toBeNull();
    });

    it("rethrows a genuine database error", async () => {
        thrown = Object.assign(new Error("connection lost"), { code: "08006" });

        await expect(chargeRun(movement)).rejects.toThrow("connection lost");
    });

    it("guards the balance so it can never go negative", async () => {
        rows = [{ balance: 0 }];

        await chargeRun(movement);

        expect(statement()).toContain('"ussageCredits" >= ');
    });

    it("records the movement as a debit against the Run and Agent", async () => {
        rows = [{ balance: 3 }];

        await chargeRun(movement);

        const sql = statement();
        expect(sql).toContain("creditLedger");
        expect(sql).toContain("debit");
        expect(sql).toContain("run_accepted");
        expect(sql).toContain(`charge:${movement.runId}`);
    });

    it("charges the Run's own cost rather than a hard-coded 1", async () => {
        rows = [{ balance: 90 }];

        await chargeRun({ ...movement, cost: 7 });

        expect(statement()).toContain("7");
    });
});

describe("refundRun", () => {
    const refund = { ...movement, reason: "worker_failure" as const };

    it("returns the restored balance", async () => {
        rows = [{ balance: 42 }];

        await expect(refundRun(refund)).resolves.toEqual({ balance: 42 });
    });

    it("refunds a Run at most once", async () => {
        // A retried worker step must not hand back two credits. The unique key
        // aborts the second statement and the increment rolls back with it.
        thrown = duplicateKey;

        await expect(refundRun(refund)).resolves.toBeNull();
    });

    it("records the reason it was issued", async () => {
        rows = [{ balance: 42 }];

        await refundRun({ ...refund, reason: "cancelled_before_execution" });

        expect(statement()).toContain("cancelled_before_execution");
    });

    it("applies no balance guard, so a refund works at zero", async () => {
        // A failed Run often leaves the balance at 0. That is exactly when the
        // refund has to work.
        rows = [{ balance: 1 }];

        await refundRun(refund);

        const sql = statement();
        expect(sql).toContain('"ussageCredits" + ');
        expect(sql).not.toContain('"ussageCredits" >= ');
    });

    it("rethrows a genuine database error", async () => {
        thrown = Object.assign(new Error("connection lost"), { code: "08006" });

        await expect(refundRun(refund)).rejects.toThrow("connection lost");
    });
});
