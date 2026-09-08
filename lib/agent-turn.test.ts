import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Run is unique on its Agent and scheduled time. Conversational turns take
 * that time from the clock, so two messages to one Team member in the same
 * millisecond collide, and the loser used to throw with the person's message
 * unanswered and nothing to show for it.
 */
const mocks = vi.hoisted(() => ({
    attempts: [] as Record<string, unknown>[],
    failures: 0,
    chargeRun: vi.fn(),
    refundRun: vi.fn(),
    executeAgent: vi.fn(),
    updated: [] as Record<string, unknown>[],
}));

const duplicate = () => Object.assign(new Error("duplicate key"), { code: "23505" });

vi.mock("@/db", () => ({
    db: {
        insert: () => ({
            values: (values: Record<string, unknown>) => ({
                returning: () => {
                    mocks.attempts.push(values);

                    if (mocks.attempts.length <= mocks.failures) {
                        return Promise.reject(duplicate());
                    }

                    return Promise.resolve([{ id: `run-${mocks.attempts.length}`, creditCost: 1 }]);
                },
            }),
        }),
        update: () => ({
            set: (values: Record<string, unknown>) => ({
                where: () => {
                    mocks.updated.push(values);
                    return Promise.resolve([]);
                },
            }),
        }),
        delete: () => ({ where: () => Promise.resolve([]) }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    },
    AgentRun: { id: "id" },
    AgentConfig: { agentId: "agentId", userEmail: "email" },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => ({ c }),
    eq: (col: unknown, v: unknown) => ({ col, v }),
}));

vi.mock("@/lib/credits", () => ({
    chargeRun: mocks.chargeRun,
    refundRun: mocks.refundRun,
    creditCostFor: () => 1,
    isPaid: (r: { outcome: string }) => r.outcome === "charged" || r.outcome === "already_charged",
}));

vi.mock("@/lib/execute-agent", () => ({ executeAgent: mocks.executeAgent }));

import { runAgentTurn } from "@/lib/agent-turn";

const agentConfig = { agentId: "agent-1", status: "active", schedule: {} } as never;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.attempts.length = 0;
    mocks.updated.length = 0;
    mocks.failures = 0;
    mocks.chargeRun.mockResolvedValue({ outcome: "charged", balance: 9 });
    mocks.refundRun.mockResolvedValue({ outcome: "refunded", balance: 10 });
    mocks.executeAgent.mockResolvedValue({ finalOutput: "here you go" });
});

describe("runAgentTurn", () => {
    it("runs the turn and reports the answer", async () => {
        const result = await runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" });

        expect(result).toMatchObject({ outcome: "completed", output: "here you go" });
        expect(mocks.chargeRun).toHaveBeenCalledTimes(1);
    });

    it("retries past a colliding occurrence rather than losing the message", async () => {
        mocks.failures = 1;

        const result = await runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" });

        expect(result.outcome).toBe("completed");
        expect(mocks.attempts).toHaveLength(2);
        // Nudged forward, so the second attempt does not collide again.
        expect((mocks.attempts[1].scheduledFor as Date).getTime()).toBeGreaterThan(
            (mocks.attempts[0].scheduledFor as Date).getTime(),
        );
    });

    it("charges exactly once even when the insert had to retry", async () => {
        mocks.failures = 2;

        await runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" });

        expect(mocks.chargeRun).toHaveBeenCalledTimes(1);
    });

    it("gives up rather than looping forever", async () => {
        mocks.failures = 99;

        await expect(
            runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" }),
        ).rejects.toThrow();

        expect(mocks.attempts.length).toBeLessThanOrEqual(6);
    });

    it("does not swallow a failure that is not a collision", async () => {
        const boom = Object.assign(new Error("connection refused"), { code: "08006" });

        vi.spyOn(Promise, "resolve");
        mocks.attempts.length = 0;
        mocks.failures = 0;

        // Replace the insert outcome with a non-duplicate error once.
        const { db } = await import("@/db");
        const original = db.insert;
        (db as { insert: unknown }).insert = () => ({
            values: () => ({ returning: () => Promise.reject(boom) }),
        });

        await expect(
            runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" }),
        ).rejects.toThrow("connection refused");

        (db as { insert: unknown }).insert = original;
    });

    it("refunds and reports when the Agent itself fails", async () => {
        mocks.executeAgent.mockRejectedValue(new Error("model unavailable"));

        const result = await runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" });

        expect(result).toMatchObject({ outcome: "failed" });
        expect(mocks.refundRun).toHaveBeenCalledWith(
            expect.objectContaining({ reason: "agent_failure" }),
        );
    });

    it("does not run the Agent when there is no credit for it", async () => {
        mocks.chargeRun.mockResolvedValue({ outcome: "insufficient" });

        const result = await runAgentTurn({ agentConfig, userEmail: "owner@example.com", input: "hi" });

        expect(result).toEqual({ outcome: "insufficient_credit" });
        expect(mocks.executeAgent).not.toHaveBeenCalled();
    });
});
