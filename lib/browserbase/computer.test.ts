import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The agent's control gate, with a fake lease and a fake browser. What these
 * prove: a fenced-out worker performs nothing, waits, and when control comes
 * back under a new generation it looks again before acting. The lease
 * arithmetic itself is proven against PostgreSQL in control.concurrency.test.
 */
const { events, dispatched, driverMocks, storeArtifact } = vi.hoisted(() => {
    const events: Array<{ kind: string; detail?: Record<string, unknown> }> = [];
    const dispatched: unknown[] = [];
    return {
        events,
        dispatched,
        storeArtifact: vi.fn(async () => ({ id: "art-1" })),
        driverMocks: {
            dispatchAction: vi.fn(async (_s: string, a: unknown) => { dispatched.push(a); }),
            capturePng: vi.fn(async () => ({ png: Buffer.from("png"), url: "https://example.com/", title: "Example" })),
            setViewport: vi.fn(async () => undefined),
            currentLocation: vi.fn(async () => ({ url: "https://example.com/after", title: "After", tabCount: 1 })),
        },
    };
});

vi.mock("@/lib/browserbase/activity", () => ({
    recordEventWithRetry: vi.fn(async (p: { kind: string; detail?: Record<string, unknown> }) => {
        events.push({ kind: p.kind, detail: p.detail });
        return { sequence: events.length };
    }),
}));
vi.mock("@/lib/browserbase/driver", () => driverMocks);
vi.mock("@/lib/browserbase/storage", () => ({ storeArtifact }));
vi.mock("@/lib/browserbase/control", () => ({ authorizeInput: vi.fn() }));

import {
    BrowserbaseComputer,
    HandoverTimeoutError,
    MAX_HANDOVER_WAIT_MS,
    RunCancelledError,
    normaliseModelKeys,
    type ComputerDeps,
} from "@/lib/browserbase/computer";

const params = {
    browserbaseSessionId: "bb-sess",
    browserRunId: "11111111-1111-1111-1111-111111111111",
    userEmail: "u@e.com",
    agentId: "ag-1",
    sessionRecordId: "22222222-2222-2222-2222-222222222222",
    workerId: "worker-1",
    generation: 1,
};

/** A lease the test moves by hand. */
function fakeLease(initial: { kind: "agent" | "human" | "none"; generation: number }) {
    const lease = { ...initial };
    let clock = 0;
    let cancelled = false;

    const deps: ComputerDeps = {
        authorize: async generation => {
            if (lease.kind !== "agent") return { allowed: false, reason: "not_holder" };
            if (lease.generation !== generation) return { allowed: false, reason: "stale_generation" };
            return { allowed: true, generation };
        },
        currentAgentGeneration: async () => (lease.kind === "agent" ? lease.generation : null),
        isCancelled: async () => cancelled,
        sleep: async ms => { clock += ms; },
        now: () => clock,
    };

    return {
        deps,
        lease,
        cancel: () => { cancelled = true; },
        /** Schedules a lease change after n polls. */
        after(polls: number, change: () => void) {
            let seen = 0;
            const original = deps.currentAgentGeneration;
            deps.currentAgentGeneration = async () => {
                seen += 1;
                if (seen === polls) change();
                return original();
            };
        },
    };
}

beforeEach(() => {
    events.length = 0;
    dispatched.length = 0;
});

describe("BrowserbaseComputer gate", () => {
    it("performs an action while it holds control", async () => {
        const { deps } = fakeLease({ kind: "agent", generation: 1 });
        const computer = new BrowserbaseComputer(params, deps);

        await computer.click(10, 20, "left");

        expect(dispatched).toEqual([{ type: "click", x: 10, y: 20, button: "left", clickCount: 1 }]);
        expect(events.map(e => e.kind)).toEqual(["action_proposed", "action_executed"]);
    });

    it("performs nothing while a human holds control, then drops the stale action when control returns", async () => {
        const fake = fakeLease({ kind: "human", generation: 2 });
        fake.after(3, () => { fake.lease.kind = "agent"; fake.lease.generation = 3; });
        const computer = new BrowserbaseComputer(params, fake.deps);

        await computer.click(10, 20, "left");

        // The click proposed under generation 1 never reaches the browser.
        expect(dispatched).toEqual([]);
        expect(computer.generation).toBe(3);
        expect(events.map(e => e.kind)).toContain("warning");
        expect(events.find(e => e.detail?.reason === "stale_action_invalidated")?.detail).toMatchObject({
            previousGeneration: 1, generation: 3,
        });
        // The viewport is restored for the agent and its location refreshed.
        expect(driverMocks.setViewport).toHaveBeenCalledWith("bb-sess", { width: 1280, height: 800 });
        expect(events.find(e => e.kind === "navigation")?.detail).toMatchObject({ refreshed: true });
    });

    it("refuses further actions until the model has taken a fresh screenshot", async () => {
        const fake = fakeLease({ kind: "none", generation: 2 });
        fake.after(1, () => { fake.lease.kind = "agent"; fake.lease.generation = 3; });
        const computer = new BrowserbaseComputer(params, fake.deps);

        await computer.click(1, 1, "left");   // dropped: handover happened here
        await computer.type("hello");         // refused: no fresh look yet
        expect(dispatched).toEqual([]);
        expect(events.some(e => e.detail?.reason === "action_before_fresh_look")).toBe(true);

        await computer.screenshot();          // the fresh look
        await computer.type("hello");         // now allowed
        expect(dispatched).toEqual([{ type: "text", text: "hello" }]);
    });

    it("stops as cancelled the moment Stop is requested, even mid-wait", async () => {
        const fake = fakeLease({ kind: "human", generation: 2 });
        fake.after(2, () => fake.cancel());
        const computer = new BrowserbaseComputer(params, fake.deps);

        await expect(computer.click(1, 1, "left")).rejects.toBeInstanceOf(RunCancelledError);
        expect(dispatched).toEqual([]);
    });

    it("fails the run rather than waiting forever for a handover", async () => {
        const fake = fakeLease({ kind: "human", generation: 2 });
        const computer = new BrowserbaseComputer(params, fake.deps);

        await expect(computer.click(1, 1, "left")).rejects.toBeInstanceOf(HandoverTimeoutError);
        expect(fake.deps.now()).toBeGreaterThanOrEqual(MAX_HANDOVER_WAIT_MS);
    });

    it("refuses a worker whose own generation has been superseded", async () => {
        // Same holder, older generation: exactly the resumed-old-worker case.
        const fake = fakeLease({ kind: "agent", generation: 5 });
        const computer = new BrowserbaseComputer({ ...params, generation: 4 }, fake.deps);

        await computer.click(1, 1, "left");

        expect(dispatched).toEqual([]);
        expect(computer.generation).toBe(5);
    });

    it("records the length of typed text, never the text", async () => {
        const { deps } = fakeLease({ kind: "agent", generation: 1 });
        const computer = new BrowserbaseComputer(params, deps);

        await computer.type("hunter2");

        const details = events.map(e => JSON.stringify(e.detail ?? {}));
        expect(details.join(" ")).not.toContain("hunter2");
        expect(events[0].detail).toMatchObject({ type: "type", length: 7 });
    });

    it("stores every screenshot as an artifact and records it", async () => {
        const { deps } = fakeLease({ kind: "agent", generation: 1 });
        const computer = new BrowserbaseComputer(params, deps);

        const base64 = await computer.screenshot();

        expect(base64).toBe(Buffer.from("png").toString("base64"));
        expect(storeArtifact).toHaveBeenCalledWith(expect.objectContaining({ source: "screenshot", mimeType: "image/png" }));
        expect(events.find(e => e.kind === "screenshot")?.detail).toMatchObject({ artifactId: "art-1", url: "https://example.com/" });
    });

    it("does not even take a screenshot while paused", async () => {
        const fake = fakeLease({ kind: "none", generation: 2 });
        fake.after(1, () => { fake.lease.kind = "agent"; fake.lease.generation = 3; });
        const computer = new BrowserbaseComputer(params, fake.deps);

        await computer.screenshot();

        // One capture, and only after control came back.
        expect(driverMocks.capturePng).toHaveBeenCalledTimes(1);
        expect(computer.generation).toBe(3);
    });
});

describe("normaliseModelKeys", () => {
    it("maps the model's key spellings onto the shared whitelist", () => {
        expect(normaliseModelKeys(["ctrl", "a"])).toBe("Control+a");
        expect(normaliseModelKeys(["CTRL+A"])).toBe("Control+A");
        expect(normaliseModelKeys(["Return"])).toBe("Enter");
        expect(normaliseModelKeys(["space"])).toBe("Space");
        expect(normaliseModelKeys(["f5"])).toBe("F5");
    });

    it("refuses combinations that are not a keypress", () => {
        expect(normaliseModelKeys(["ctrl"])).toBeNull();
        expect(normaliseModelKeys(["a", "b"])).toBeNull();
        expect(normaliseModelKeys(["Bogus"])).toBeNull();
        expect(normaliseModelKeys([])).toBeNull();
    });
});
