import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Run history is owner-scoped. Found during production smoke testing: this
 * route had no guard at all, and fell through to the database with an empty
 * email for an unauthenticated caller. Nothing leaked, because an empty email
 * matches no rows, but an unauthenticated request should never reach the
 * database in the first place.
 */
const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    select: vi.fn(),
    orderBy: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.currentUser }));

vi.mock("@/db", () => ({
    db: { select: mocks.select },
    AgentRun: { id: "id", agentId: "agentId", userEmail: "email", status: "status", output: "output", error: "error", scheduledFor: "scheduledFor", completedAt: "completedAt", createdAt: "createdAt" },
    AgentConfig: { agentId: "agentId", name: "name", agentImage: "agentImage", description: "description" },
}));

vi.mock("drizzle-orm", () => ({
    desc: () => ({}),
    eq: (col: unknown, value: unknown) => ({ col, value }),
}));

import { GET } from "./route";

const request = new Request("http://localhost/api/agentlog") as unknown as import("next/server").NextRequest;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderBy.mockResolvedValue([]);
    mocks.select.mockReturnValue({
        from: () => ({ leftJoin: () => ({ where: () => ({ orderBy: mocks.orderBy }) }) }),
    });
});

describe("GET /api/agentlog", () => {
    it("refuses an unauthenticated caller without querying the database", async () => {
        mocks.currentUser.mockResolvedValue(null);

        const response = await GET(request);

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: "Unauthorized User" });
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it("refuses a session carrying no email address", async () => {
        mocks.currentUser.mockResolvedValue({ primaryEmailAddress: null });

        const response = await GET(request);

        expect(response.status).toBe(401);
        expect(mocks.select).not.toHaveBeenCalled();
    });

    it("returns the caller's own runs", async () => {
        mocks.currentUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "owner@example.com" } });
        mocks.orderBy.mockResolvedValue([{ id: "run-1" }]);

        const response = await GET(request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([{ id: "run-1" }]);
        expect(mocks.select).toHaveBeenCalled();
    });
});
