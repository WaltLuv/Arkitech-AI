import { beforeEach, describe, expect, it, vi } from "vitest";

const { createSession, findSessionByCreationKey, releaseSession, retrieveSession } =
    vi.hoisted(() => ({
        createSession: vi.fn(),
        findSessionByCreationKey: vi.fn(),
        releaseSession: vi.fn(),
        retrieveSession: vi.fn(),
    }));

vi.mock("@/lib/browserbase/client", () => ({
    createSession, findSessionByCreationKey, releaseSession, retrieveSession,
}));

// Records what was written, so the tests assert on persisted state.
const updates: Array<Record<string, unknown>> = [];
let rows: Array<Record<string, unknown>> = [];

vi.mock("@/db", () => {
    const where = vi.fn(async () => rows);
    return {
        db: {
            insert: () => ({ values: () => ({ returning: async () => [{ id: "rec-1" }] }) }),
            update: () => ({
                set: (v: Record<string, unknown>) => {
                    updates.push(v);
                    return { where: async () => undefined };
                },
            }),
            select: () => ({ from: () => ({ where }) }),
            execute: async () => ({ rows: [] }),
        },
        browserSession: { id: "id", status: "status", createdAt: "createdAt" },
    };
});

vi.mock("drizzle-orm", () => ({
    and: (...c: unknown[]) => c, eq: () => ({}), inArray: () => ({}), lt: () => ({}),
    sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));

import { mapProviderStatus, openSessionForRun, releaseSessionForRecord } from "@/lib/browserbase/session";

const params = { browserRunId: "11111111-1111-1111-1111-111111111111", userEmail: "u@e.com" };

beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    rows = [];
});

describe("mapProviderStatus", () => {
    it.each([
        ["RUNNING", "running"], ["PENDING", "running"], ["COMPLETED", "released"],
        ["TIMED_OUT", "timed_out"], ["ERROR", "errored"],
    ])("maps %s to %s", (provider, expected) => {
        expect(mapProviderStatus(provider)).toBe(expected);
    });

    it("treats anything unrecognised as unknown rather than guessing", () => {
        expect(mapProviderStatus("SOMETHING_NEW")).toBe("unknown");
    });
});

describe("openSessionForRun", () => {
    it("records the provider session on success", async () => {
        createSession.mockResolvedValue({ id: "bb-1", status: "RUNNING" });

        const result = await openSessionForRun(params);

        expect(result).toMatchObject({ ok: true, browserbaseSessionId: "bb-1" });
        expect(updates.at(-1)).toMatchObject({ browserbaseSessionId: "bb-1", status: "running" });
    });

    it("adopts an existing session when the create outcome was lost", async () => {
        // The provider accepted it; only the response went missing. Creating
        // another would mean paying for two browsers.
        createSession.mockRejectedValue(new Error("socket hang up"));
        findSessionByCreationKey.mockResolvedValue({ id: "bb-adopted", status: "RUNNING" });

        const result = await openSessionForRun(params);

        expect(result).toMatchObject({ ok: true, browserbaseSessionId: "bb-adopted" });
        expect(createSession).toHaveBeenCalledTimes(1);
    });

    it("never creates a second session when reconciliation finds nothing", async () => {
        createSession.mockRejectedValue(new Error("timeout"));
        findSessionByCreationKey.mockResolvedValue(null);

        const result = await openSessionForRun(params);

        expect(result).toMatchObject({ ok: false, reason: "uncertain" });
        expect(createSession).toHaveBeenCalledTimes(1);
        expect(updates.at(-1)).toMatchObject({ status: "unknown" });
    });

    it("never creates a second session when reconciliation itself fails", async () => {
        createSession.mockRejectedValue(new Error("timeout"));
        findSessionByCreationKey.mockRejectedValue(new Error("lookup failed"));

        const result = await openSessionForRun(params);

        expect(result).toMatchObject({ ok: false, reason: "uncertain" });
        expect(createSession).toHaveBeenCalledTimes(1);
    });

    it("reports missing configuration honestly instead of pretending", async () => {
        const notConfigured = Object.assign(new Error("Browser execution is not configured."), {
            name: "BrowserbaseNotConfiguredError",
        });
        createSession.mockRejectedValue(notConfigured);

        const result = await openSessionForRun(params);

        expect(result).toMatchObject({ ok: false, reason: "not_configured" });
        expect(findSessionByCreationKey).not.toHaveBeenCalled();
    });

    it("passes a unique creation key so two runs cannot be confused", async () => {
        createSession.mockResolvedValue({ id: "bb-1", status: "RUNNING" });

        await openSessionForRun(params);
        await openSessionForRun(params);

        const [first, second] = createSession.mock.calls.map(c => c[0].creationKey);
        expect(first).not.toBe(second);
    });
});

describe("releaseSessionForRecord", () => {
    it("asks the provider to release and records that it happened", async () => {
        rows = [{ id: "rec-1", browserbaseSessionId: "bb-1" }];
        releaseSession.mockResolvedValue({});

        await expect(releaseSessionForRecord("rec-1")).resolves.toBe(true);
        expect(updates.map(u => u.releaseState)).toContain("released");
    });

    it("marks a failed release so a sweep can retry, rather than swallowing it", async () => {
        // A session nobody released is a session still being paid for.
        rows = [{ id: "rec-1", browserbaseSessionId: "bb-1" }];
        releaseSession.mockRejectedValue(new Error("provider down"));

        await expect(releaseSessionForRecord("rec-1")).resolves.toBe(false);
        expect(updates.at(-1)).toMatchObject({ releaseState: "failed" });
    });

    it("closes out a record that never reached the provider", async () => {
        rows = [{ id: "rec-1", browserbaseSessionId: null }];

        await expect(releaseSessionForRecord("rec-1")).resolves.toBe(true);
        expect(releaseSession).not.toHaveBeenCalled();
    });
});
