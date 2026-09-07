import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cost bounds and measurement. The sweeps are checked against a recording
 * fake so the order of operations is visible: a run is fenced before its
 * session is released, and its slot is freed whatever else happened.
 *
 * The ledger is deliberately not mocked anywhere in this file. Nothing in
 * limits.ts imports it, and one test below proves that by inspection.
 */
const mocks = vi.hoisted(() => ({
    executed: [] as string[],
    rowsFor: new Map<string, Array<Record<string, unknown>>>(),
    selectRows: [] as Array<Record<string, unknown>>,
    revokeControl: vi.fn(),
    releaseBrowserSlot: vi.fn(),
    releaseSessionForRecord: vi.fn(),
    findAbandonedSessions: vi.fn(),
    recordEventWithRetry: vi.fn(async () => ({ sequence: 1 })),
}));

/** Matches a statement by a fragment, so tests name intent not whitespace. */
function stubExecute(fragment: string, rows: Array<Record<string, unknown>>) {
    mocks.rowsFor.set(fragment, rows);
}

vi.mock("@/db", () => ({
    db: {
        execute: vi.fn(async (query: unknown) => {
            const text = JSON.stringify(query);
            mocks.executed.push(text);
            for (const [fragment, rows] of mocks.rowsFor) {
                if (text.includes(fragment)) return { rows };
            }
            return { rows: [] };
        }),
        select: () => ({ from: () => ({ where: async () => mocks.selectRows }) }),
    },
    browserRun: { id: "id", status: "status" },
    browserSession: { id: "id", browserRunId: "browser_run_id", status: "status" },
}));

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => c,
    eq: () => ({}),
    // Records the literal fragments so a test can assert on the statement.
    sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
        { raw: (s: string) => s },
    ),
}));

vi.mock("@/lib/browserbase/control", () => ({ revokeControl: mocks.revokeControl }));
vi.mock("@/lib/browserbase/queue", () => ({ releaseBrowserSlot: mocks.releaseBrowserSlot }));
vi.mock("@/lib/browserbase/session", () => ({
    findAbandonedSessions: mocks.findAbandonedSessions,
    releaseSessionForRecord: mocks.releaseSessionForRecord,
}));
vi.mock("@/lib/browserbase/activity", () => ({ recordEventWithRetry: mocks.recordEventWithRetry }));

import {
    DEFAULT_LIMITS,
    browserUsageForOwner,
    failExhaustedRuns,
    readBrowserLimits,
    recordRunUsage,
    runDurationMs,
    sweepAbandonedSessions,
    sweepOverrunningRuns,
} from "@/lib/browserbase/limits";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.executed.length = 0;
    mocks.rowsFor.clear();
    mocks.selectRows = [];
    mocks.revokeControl.mockResolvedValue(2);
    mocks.releaseBrowserSlot.mockResolvedValue(undefined);
    mocks.releaseSessionForRecord.mockResolvedValue(true);
    mocks.findAbandonedSessions.mockResolvedValue([]);
});

describe("readBrowserLimits", () => {
    it("defaults to one slot when nothing is configured", () => {
        expect(readBrowserLimits({} as NodeJS.ProcessEnv)).toEqual(DEFAULT_LIMITS);
        expect(DEFAULT_LIMITS.slotLimit).toBe(1);
    });

    it("reads a configured cap", () => {
        const limits = readBrowserLimits({
            BROWSER_SLOT_LIMIT: "4",
            BROWSER_MAX_RUN_MS: "60000",
            BROWSER_MAX_ATTEMPTS: "2",
        } as unknown as NodeJS.ProcessEnv);

        expect(limits.slotLimit).toBe(4);
        expect(limits.maxRunMs).toBe(60000);
        expect(limits.maxAttempts).toBe(2);
    });

    it("ignores nonsense rather than uncapping anything", () => {
        const limits = readBrowserLimits({
            BROWSER_SLOT_LIMIT: "0",
            BROWSER_MAX_RUN_MS: "-5",
            BROWSER_MAX_SESSION_MS: "not a number",
            BROWSER_MAX_ATTEMPTS: "1.5",
        } as unknown as NodeJS.ProcessEnv);

        expect(limits).toEqual(DEFAULT_LIMITS);
    });

    it("clamps a value above the ceiling instead of trusting it", () => {
        const limits = readBrowserLimits({
            BROWSER_SLOT_LIMIT: "10000",
            BROWSER_MAX_RUN_MS: "999999999",
        } as unknown as NodeJS.ProcessEnv);

        expect(limits.slotLimit).toBe(20);
        expect(limits.maxRunMs).toBe(2 * 60 * 60 * 1000);
    });
});

describe("runDurationMs", () => {
    it("measures from the start to the end", () => {
        const start = new Date("2026-01-01T00:00:00Z");
        const end = new Date("2026-01-01T00:05:00Z");
        expect(runDurationMs(start, end)).toBe(300_000);
    });

    it("measures an unfinished run up to now", () => {
        const start = new Date("2026-01-01T00:00:00Z");
        const now = new Date("2026-01-01T00:02:00Z");
        expect(runDurationMs(start, null, now)).toBe(120_000);
    });

    it("is null for a run that never started, and never negative", () => {
        expect(runDurationMs(null, new Date())).toBeNull();
        const start = new Date("2026-01-01T00:05:00Z");
        const end = new Date("2026-01-01T00:00:00Z");
        expect(runDurationMs(start, end)).toBe(0);
    });
});

describe("sweepOverrunningRuns", () => {
    beforeEach(() => {
        stubExecute("failure_reason", [{ id: "run-1", email: "owner@example.com" }]);
        mocks.selectRows = [{ id: "sess-1" }];
    });

    it("fences the run before releasing its session", async () => {
        const stopped = await sweepOverrunningRuns();

        expect(stopped).toBe(1);
        expect(mocks.revokeControl).toHaveBeenCalledWith({ browserRunId: "run-1", userEmail: "owner@example.com" });
        expect(mocks.revokeControl.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.releaseSessionForRecord.mock.invocationCallOrder[0]);
    });

    it("releases the session and frees the slot", async () => {
        await sweepOverrunningRuns();

        expect(mocks.releaseSessionForRecord).toHaveBeenCalledWith("sess-1");
        expect(mocks.releaseBrowserSlot).toHaveBeenCalledWith("run-1");
    });

    it("records why the run was stopped", async () => {
        await sweepOverrunningRuns();

        expect(mocks.recordEventWithRetry).toHaveBeenCalledWith(expect.objectContaining({
            kind: "cancelled",
            actor: "system",
            detail: expect.objectContaining({ reason: "max_run_duration_exceeded" }),
        }));
    });

    it("does nothing when no run has overrun", async () => {
        mocks.rowsFor.clear();

        expect(await sweepOverrunningRuns()).toBe(0);
        expect(mocks.releaseBrowserSlot).not.toHaveBeenCalled();
    });
});

describe("sweepAbandonedSessions", () => {
    it("releases a session whose worker died", async () => {
        mocks.findAbandonedSessions.mockResolvedValue([{ id: "sess-9", userEmail: "owner@example.com" }]);
        mocks.selectRows = [{ browserRunId: "run-9" }];

        const swept = await sweepAbandonedSessions();

        expect(swept).toBe(1);
        expect(mocks.releaseSessionForRecord).toHaveBeenCalledWith("sess-9");
    });

    it("releases a session left open by a run that already finished", async () => {
        stubExecute("browserSession", [{ id: "sess-orphan", email: "owner@example.com" }]);
        mocks.selectRows = [{ browserRunId: "run-done" }];

        const swept = await sweepAbandonedSessions();

        expect(swept).toBe(1);
        expect(mocks.releaseSessionForRecord).toHaveBeenCalledWith("sess-orphan");
    });

    it("releases each session once when both sweeps find it", async () => {
        mocks.findAbandonedSessions.mockResolvedValue([{ id: "sess-both", userEmail: "owner@example.com" }]);
        stubExecute("browserSession", [{ id: "sess-both", email: "owner@example.com" }]);
        mocks.selectRows = [{ browserRunId: "run-both" }];

        const swept = await sweepAbandonedSessions();

        expect(swept).toBe(1);
        expect(mocks.releaseSessionForRecord).toHaveBeenCalledTimes(1);
    });
});

describe("failExhaustedRuns", () => {
    it("gives up honestly and frees the slot", async () => {
        stubExecute("Gave up after", [{ id: "run-x", email: "owner@example.com" }]);

        const failed = await failExhaustedRuns();

        expect(failed).toBe(1);
        expect(mocks.releaseBrowserSlot).toHaveBeenCalledWith("run-x");
        expect(mocks.recordEventWithRetry).toHaveBeenCalledWith(expect.objectContaining({
            kind: "failed",
            detail: expect.objectContaining({ reason: "max_attempts_exhausted" }),
        }));
    });
});

describe("measurement", () => {
    it("writes the duration and the bytes for a run", async () => {
        stubExecute("artifact_bytes", [{ duration_ms: 42_000, artifact_bytes: "20480" }]);

        expect(await recordRunUsage("run-1")).toEqual({ durationMs: 42_000, artifactBytes: 20480 });
    });

    it("reports zero bytes rather than null when a run left no evidence", async () => {
        stubExecute("artifact_bytes", [{ duration_ms: null, artifact_bytes: null }]);

        expect(await recordRunUsage("run-1")).toEqual({ durationMs: null, artifactBytes: 0 });
    });

    it("scopes an owner's usage to that owner in the query", async () => {
        stubExecute("active_runs", [{ runs: 3, total_duration_ms: "900000", total_artifact_bytes: "1024", active_runs: 1 }]);

        const usage = await browserUsageForOwner("owner@example.com");

        expect(usage).toEqual({ runs: 3, totalDurationMs: 900_000, totalArtifactBytes: 1024, activeRuns: 1 });
        expect(mocks.executed.some(text => text.includes("owner@example.com"))).toBe(true);
    });
});

describe("no new charge for browser work", () => {
    it("never touches the ledger", async () => {
        stubExecute("failure_reason", [{ id: "run-1", email: "owner@example.com" }]);
        stubExecute("Gave up after", [{ id: "run-2", email: "owner@example.com" }]);
        mocks.findAbandonedSessions.mockResolvedValue([{ id: "sess-1", userEmail: "owner@example.com" }]);
        mocks.selectRows = [{ id: "sess-1", browserRunId: "run-1" }];

        await sweepOverrunningRuns();
        await failExhaustedRuns();
        await sweepAbandonedSessions();
        await recordRunUsage("run-1");
        await browserUsageForOwner("owner@example.com");

        // Every statement this module issued, and not one of them writes a
        // credit. Browser work is paid for by the Run charge that already
        // exists; a second charge here would be a price change in disguise.
        const statements = mocks.executed.join(" ");
        expect(statements).not.toMatch(/creditLedger/i);
        expect(statements).not.toMatch(/ussageCredits|usageCredits/i);
    });
});
