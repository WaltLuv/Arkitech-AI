import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The input route from the point of view of a manipulated frontend. Every
 * server-side check is exercised by a request that skips or forges it, and
 * the browser is only ever reached when all of them pass.
 */
const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    loadOwnedBrowserRun: vi.fn(),
    latestSessionForRun: vi.fn(),
    authorizeHumanInput: vi.fn(),
    currentViewport: vi.fn(),
    dispatchAction: vi.fn(),
    recordEventWithRetry: vi.fn(async (_p: { detail?: Record<string, unknown> }) => ({ sequence: 1 })),
}));

vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/browserbase/operator", () => ({
    loadOwnedBrowserRun: mocks.loadOwnedBrowserRun,
    latestSessionForRun: mocks.latestSessionForRun,
    authorizeHumanInput: mocks.authorizeHumanInput,
}));
vi.mock("@/lib/browserbase/driver", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/browserbase/driver")>()),
    currentViewport: mocks.currentViewport,
    dispatchAction: mocks.dispatchAction,
}));
vi.mock("@/lib/browserbase/activity", () => ({ recordEventWithRetry: mocks.recordEventWithRetry }));

import { POST } from "./route";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ browserRunId: RUN_ID });

function request(body: unknown) {
    return new Request(`http://localhost/api/browser/runs/${RUN_ID}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest;
}

const validBody = {
    channelId: "human-abc",
    generation: 4,
    rendered: { width: 360, height: 225 },
    action: { type: "click", x: 180, y: 112.5 },
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "owner@example.com" } });
    mocks.loadOwnedBrowserRun.mockResolvedValue({ id: RUN_ID, status: "running" });
    mocks.latestSessionForRun.mockResolvedValue({ id: "sess-rec", browserbaseSessionId: "bb-1", status: "running" });
    mocks.authorizeHumanInput.mockResolvedValue({ allowed: true, generation: 4 });
    mocks.currentViewport.mockResolvedValue({ width: 1280, height: 800 });
    mocks.dispatchAction.mockResolvedValue(undefined);
});

describe("POST /api/browser/runs/[id]/input", () => {
    it("dispatches a well-formed, authorised click scaled into the viewport", async () => {
        const response = await POST(request(validBody), { params });

        expect(response.status).toBe(200);
        expect(mocks.dispatchAction).toHaveBeenCalledWith("bb-1", {
            type: "click", x: 640, y: 400, button: "left", clickCount: 1,
        });
        expect(mocks.authorizeHumanInput).toHaveBeenCalledWith({
            browserRunId: RUN_ID, userEmail: "owner@example.com", channelId: "human-abc", generation: 4,
        });
    });

    it("refuses an unauthenticated caller before touching anything", async () => {
        mocks.currentUser.mockResolvedValue(null);

        const response = await POST(request(validBody), { params });

        expect(response.status).toBe(401);
        expect(mocks.loadOwnedBrowserRun).not.toHaveBeenCalled();
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("answers 404 for a run the caller does not own, revealing nothing", async () => {
        mocks.loadOwnedBrowserRun.mockResolvedValue(null);

        const response = await POST(request(validBody), { params });

        expect(response.status).toBe(404);
        expect(mocks.authorizeHumanInput).not.toHaveBeenCalled();
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("refuses a body missing the channel or generation", async () => {
        const noChannel = await POST(request({ ...validBody, channelId: undefined }), { params });
        const noGeneration = await POST(request({ ...validBody, generation: "4" }), { params });

        expect(noChannel.status).toBe(400);
        expect(noGeneration.status).toBe(400);
        expect(mocks.authorizeHumanInput).not.toHaveBeenCalled();
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it.each([
        ["no_lease"], ["not_holder"], ["stale_generation"], ["expired"],
    ])("refuses with 403 when the lease check says %s, and never reaches the browser", async reason => {
        mocks.authorizeHumanInput.mockResolvedValue({ allowed: false, reason });

        const response = await POST(request(validBody), { params });

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "Not in control", reason });
        expect(mocks.currentViewport).not.toHaveBeenCalled();
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("refuses an action outside the rendered frame even for the controller", async () => {
        const response = await POST(request({ ...validBody, action: { type: "click", x: 9999, y: 1 } }), { params });

        expect(response.status).toBe(400);
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("refuses an action type the mapper does not know", async () => {
        const response = await POST(request({ ...validBody, action: { type: "navigate", url: "https://evil.example" } }), { params });

        expect(response.status).toBe(400);
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("refuses when the run has no live session", async () => {
        mocks.latestSessionForRun.mockResolvedValue({ id: "sess-rec", browserbaseSessionId: "bb-1", status: "released" });

        const response = await POST(request(validBody), { params });

        expect(response.status).toBe(409);
        expect(mocks.dispatchAction).not.toHaveBeenCalled();
    });

    it("records typed text as a length, never as content", async () => {
        await POST(request({ ...validBody, action: { type: "text", text: "hunter2" } }), { params });

        const detail = mocks.recordEventWithRetry.mock.calls[0][0] as { detail?: Record<string, unknown> };
        expect(JSON.stringify(detail)).not.toContain("hunter2");
        expect(detail.detail).toMatchObject({ type: "text", length: 7, generation: 4 });
    });

    it("never includes a provider URL in any response", async () => {
        mocks.dispatchAction.mockRejectedValue(new Error("connect failed: wss://connect.browserbase.com?apiKey=bb_live_secret"));

        const response = await POST(request(validBody), { params });
        const text = JSON.stringify(await response.json());

        // A raw error, as if thrown past the driver's own redaction.
        expect(response.status).toBe(502);
        expect(text).not.toMatch(/wss:\/\//);
        expect(text).not.toContain("bb_live_secret");
    });
});
