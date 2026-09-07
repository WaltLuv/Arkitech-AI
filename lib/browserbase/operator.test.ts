import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The operator verbs with a fake database. Each verb's precondition, event,
 * and refusal are checked here; the lease statement itself is proven in
 * control.concurrency.test against PostgreSQL.
 */
const mocks = vi.hoisted(() => ({
    rows: [] as Array<Record<string, unknown>>,
    leaseRow: null as Record<string, unknown> | null,
    events: [] as Array<{ kind: string; actor: string; detail?: Record<string, unknown> }>,
    grantControl: vi.fn(),
    revokeControl: vi.fn(),
    renewControl: vi.fn(),
    authorizeInput: vi.fn(),
    requestCancellation: vi.fn(),
}));

vi.mock("@/db", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => Object.assign(Promise.resolve(mocks.rows), {
                    orderBy: () => ({ limit: async () => mocks.rows }),
                }),
            }),
        }),
        execute: async () => ({ rows: mocks.leaseRow ? [mocks.leaseRow] : [] }),
    },
    browserRun: { id: "id", userEmail: "email" },
    browserSession: {},
}));
vi.mock("drizzle-orm", () => ({
    and: () => ({}), eq: () => ({}), desc: () => ({}),
    sql: Object.assign(() => ({}), { raw: () => ({}) }),
}));
vi.mock("@/lib/browserbase/activity", () => ({
    recordEventWithRetry: vi.fn(async (p: { kind: string; actor: string; detail?: Record<string, unknown> }) => {
        mocks.events.push({ kind: p.kind, actor: p.actor, detail: p.detail });
        return { sequence: mocks.events.length };
    }),
}));
vi.mock("@/lib/browserbase/control", () => ({
    grantControl: mocks.grantControl,
    revokeControl: mocks.revokeControl,
    renewControl: mocks.renewControl,
    authorizeInput: mocks.authorizeInput,
}));
vi.mock("@/lib/browserbase/queue", () => ({ requestCancellation: mocks.requestCancellation }));

import {
    authorizeHumanInput,
    loadOwnedBrowserRun,
    pauseAgent,
    resumeAgent,
    returnToAgentControl,
    stopRun,
    takeControl,
} from "@/lib/browserbase/operator";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const OWNER = "owner@example.com";

const runningRun = { id: RUN_ID, userEmail: OWNER, status: "running", claimedBy: "worker-1", priority: "normal", queuedAt: new Date() };

function lease(kind: "agent" | "human" | "none", generation: number, expiresInMs = 60_000) {
    mocks.leaseRow = {
        holder_kind: kind, generation,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [runningRun];
    mocks.leaseRow = null;
    mocks.events.length = 0;
    mocks.grantControl.mockResolvedValue({ generation: 9, expiresAt: new Date(0) });
    mocks.revokeControl.mockResolvedValue(8);
    mocks.requestCancellation.mockResolvedValue(true);
});

describe("loadOwnedBrowserRun", () => {
    it("refuses a malformed id before querying", async () => {
        expect(await loadOwnedBrowserRun("not-a-uuid", OWNER)).toBeNull();
        expect(await loadOwnedBrowserRun(RUN_ID, "")).toBeNull();
    });
});

describe("pauseAgent", () => {
    it("revokes the agent's generation conditionally and records the pause", async () => {
        lease("agent", 3);

        const outcome = await pauseAgent(RUN_ID, OWNER);

        expect(outcome).toEqual({ ok: true, generation: 8 });
        expect(mocks.revokeControl).toHaveBeenCalledWith({ browserRunId: RUN_ID, userEmail: OWNER, expectedGeneration: 3 });
        expect(mocks.events).toEqual([{ kind: "paused", actor: "human", detail: { generation: 8 } }]);
    });

    it("refuses when the agent is not the holder", async () => {
        lease("human", 3);
        expect(await pauseAgent(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
        expect(mocks.revokeControl).not.toHaveBeenCalled();
    });

    it("refuses when the run is not running", async () => {
        mocks.rows = [{ ...runningRun, status: "completed" }];
        expect(await pauseAgent(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
    });

    it("answers not found for a run that is not the caller's", async () => {
        mocks.rows = [];
        expect(await pauseAgent(RUN_ID, OWNER)).toEqual({ ok: false, status: 404, error: "Browser run not found" });
    });
});

describe("resumeAgent", () => {
    it("grants the worker that holds the run a fresh generation, only from a pause", async () => {
        lease("none", 4);

        const outcome = await resumeAgent(RUN_ID, OWNER);

        expect(outcome).toEqual({ ok: true, generation: 9 });
        expect(mocks.grantControl).toHaveBeenCalledWith(expect.objectContaining({
            holderKind: "agent", holderId: "worker-1", expectedGeneration: 4,
        }));
        expect(mocks.events[0]).toMatchObject({ kind: "agent_control_restored", detail: { from: "paused" } });
    });

    it("refuses while a human holds control", async () => {
        lease("human", 4);
        expect(await resumeAgent(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
        expect(mocks.grantControl).not.toHaveBeenCalled();
    });
});

describe("takeControl", () => {
    it("grants a fresh channel and returns it only to this caller", async () => {
        lease("agent", 2);

        const outcome = await takeControl(RUN_ID, OWNER, 2);

        expect(outcome).toMatchObject({ ok: true, generation: 9 });
        expect((outcome as { channelId: string }).channelId).toMatch(/^human-[0-9a-f]{24}$/);
        expect(mocks.grantControl).toHaveBeenCalledWith(expect.objectContaining({
            holderKind: "human", expectedGeneration: 2,
        }));
        expect(mocks.events.map(e => e.kind)).toEqual(["takeover_requested", "human_control"]);
    });

    it("reports a conflict when the generation moved underneath it", async () => {
        mocks.grantControl.mockResolvedValue(null);
        expect(await takeControl(RUN_ID, OWNER, 1)).toMatchObject({ ok: false, status: 409 });
    });

    it("mints a different channel every time", async () => {
        const a = await takeControl(RUN_ID, OWNER);
        const b = await takeControl(RUN_ID, OWNER);
        expect((a as { channelId: string }).channelId).not.toBe((b as { channelId: string }).channelId);
    });
});

describe("returnToAgentControl", () => {
    it("issues the agent's generation in one write that supersedes the human's", async () => {
        lease("human", 5);

        const outcome = await returnToAgentControl(RUN_ID, OWNER);

        expect(outcome).toEqual({ ok: true, generation: 9 });
        expect(mocks.grantControl).toHaveBeenCalledWith(expect.objectContaining({
            holderKind: "agent", holderId: "worker-1", expectedGeneration: 5,
        }));
        expect(mocks.revokeControl).not.toHaveBeenCalled();
        expect(mocks.events[0]).toMatchObject({ kind: "agent_control_restored", detail: { from: "human" } });
    });

    it("refuses when the agent already holds control", async () => {
        lease("agent", 5);
        expect(await returnToAgentControl(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
    });

    it("refuses when no worker holds the run", async () => {
        mocks.rows = [{ ...runningRun, claimedBy: null }];
        lease("human", 5);
        expect(await returnToAgentControl(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
    });
});

describe("stopRun", () => {
    it("requests cancellation and fences everyone out", async () => {
        const outcome = await stopRun(RUN_ID, OWNER);

        expect(outcome).toEqual({ ok: true, generation: 8 });
        expect(mocks.requestCancellation).toHaveBeenCalledWith(RUN_ID, OWNER);
        expect(mocks.revokeControl).toHaveBeenCalledWith({ browserRunId: RUN_ID, userEmail: OWNER });
        expect(mocks.events[0]).toMatchObject({ kind: "cancelled", actor: "human" });
    });

    it("refuses a run that is already finished", async () => {
        mocks.requestCancellation.mockResolvedValue(false);
        mocks.rows = [{ ...runningRun, status: "completed" }];
        expect(await stopRun(RUN_ID, OWNER)).toMatchObject({ ok: false, status: 409 });
        expect(mocks.revokeControl).not.toHaveBeenCalled();
    });
});

describe("authorizeHumanInput", () => {
    it("renews only after an allowed check, under the same generation", async () => {
        mocks.authorizeInput.mockResolvedValue({ allowed: true, generation: 7 });

        const result = await authorizeHumanInput({ browserRunId: RUN_ID, userEmail: OWNER, channelId: "human-x", generation: 7 });

        expect(result).toEqual({ allowed: true, generation: 7 });
        expect(mocks.renewControl).toHaveBeenCalledWith({ browserRunId: RUN_ID, userEmail: OWNER, holderId: "human-x", generation: 7 });
    });

    it("never renews a refused lease", async () => {
        mocks.authorizeInput.mockResolvedValue({ allowed: false, reason: "expired" });

        const result = await authorizeHumanInput({ browserRunId: RUN_ID, userEmail: OWNER, channelId: "human-x", generation: 7 });

        expect(result).toEqual({ allowed: false, reason: "expired" });
        expect(mocks.renewControl).not.toHaveBeenCalled();
    });
});
