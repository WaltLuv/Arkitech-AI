import { beforeEach, describe, expect, it, vi } from "vitest";

// Records the update chain so each test can assert on the query that was built
// without standing up a database. `returning` resolves to whatever the test
// queues in `rows`.
const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => chain),
    returning: vi.fn(async () => rows),
    // refundUsageCredit awaits the builder directly, with no .returning().
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
};

let rows: unknown[] = [];

const update = vi.fn(() => chain);

vi.mock("@/db", () => ({
    db: { update: () => update() },
    users: { email: "users.email", usageCredits: "users.usageCredits" },
}));

// Operators are recorded as plain descriptors. The point of these tests is the
// shape of the guard we build, not Drizzle's SQL generation.
vi.mock("drizzle-orm", () => ({
    and: (...conditions: unknown[]) => ({ op: "and", conditions }),
    eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
    gt: (column: unknown, value: unknown) => ({ op: "gt", column, value }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        op: "sql",
        text: strings.raw.join("?"),
        values,
    }),
}));

import { deductUsageCredit, refundUsageCredit } from "@/lib/credits";

describe("deductUsageCredit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rows = [{ usageCredits: 41 }];
    });

    it("returns the updated balance when a credit was deducted", async () => {
        await expect(deductUsageCredit("someone@example.com")).resolves.toEqual({
            usageCredits: 41,
        });
    });

    it("returns null when no row matched, rather than undefined", async () => {
        // No row matches once the balance is already 0, because of the gt guard.
        // Callers branch on null, so undefined would be a silent bug.
        rows = [];

        await expect(deductUsageCredit("broke@example.com")).resolves.toBeNull();
    });

    it("guards the deduction so a balance can never go negative", async () => {
        await deductUsageCredit("someone@example.com");

        // The whole point of doing this in the WHERE clause is atomicity: a
        // read-then-write would race between concurrent runs.
        expect(chain.where).toHaveBeenCalledWith({
            op: "and",
            conditions: [
                { op: "eq", column: "users.email", value: "someone@example.com" },
                { op: "gt", column: "users.usageCredits", value: 0 },
            ],
        });
    });

    it("decrements by exactly one, in SQL rather than in JS", async () => {
        await deductUsageCredit("someone@example.com");

        expect(chain.set).toHaveBeenCalledWith({
            usageCredits: { op: "sql", text: "? - 1", values: ["users.usageCredits"] },
        });
    });
});

describe("refundUsageCredit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rows = [];
    });

    it("increments the balance by one", async () => {
        await refundUsageCredit("someone@example.com");

        expect(chain.set).toHaveBeenCalledWith({
            usageCredits: { op: "sql", text: "? + 1", values: ["users.usageCredits"] },
        });
    });

    it("matches on email alone, with no balance guard", async () => {
        // A refund must apply even when the balance is 0, which is exactly the
        // state a failed run leaves behind.
        await refundUsageCredit("someone@example.com");

        expect(chain.where).toHaveBeenCalledWith({
            op: "eq",
            column: "users.email",
            value: "someone@example.com",
        });
    });
});
