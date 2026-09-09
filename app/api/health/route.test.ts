import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The health endpoint is the one route a deployment host reads, and the one
 * route with no session in front of it. Both of those make its response a
 * security surface, so what is asserted here is as much about what it withholds
 * as about the status code it returns.
 *
 * The database is mocked because the real client speaks Neon's HTTP protocol,
 * which a local PostgreSQL cannot answer: without this the healthy branch is
 * unreachable outside a deployed environment.
 */
const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    isBrowserbaseConfigured: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));

vi.mock("@/lib/browserbase/client", () => ({
    isBrowserbaseConfigured: mocks.isBrowserbaseConfigured,
}));

vi.mock("drizzle-orm", () => ({ sql: () => ({}) }));

import { GET } from "./route";

/** Anything here appearing in a public response would be a leak. */
const SECRET_SHAPES = [
    "postgres",
    "postgresql://",
    "neon.tech",
    "password",
    "bb_live_",
    "bb_test_",
    "sk-",
    "wss://",
];

describe("The health endpoint", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBrowserbaseConfigured.mockReturnValue(true);
    });

    it("answers 200 when the database answers", async () => {
        mocks.execute.mockResolvedValue([{ "?column?": 1 }]);

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.status).toBe("ok");
        expect(body.database).toBe("ok");
    });

    it("answers 503 when the database does not, so the host stops sending traffic", async () => {
        mocks.execute.mockRejectedValue(new Error("connect ECONNREFUSED"));

        const response = await GET();
        const body = await response.json();

        expect(response.status).toBe(503);
        expect(body.status).toBe("degraded");
        expect(body.database).toBe("unreachable");
    });

    it("reports whether browser execution is configured, never the credential", async () => {
        mocks.execute.mockResolvedValue([]);

        mocks.isBrowserbaseConfigured.mockReturnValue(true);
        expect((await (await GET()).json()).browserExecution).toBe("configured");

        mocks.isBrowserbaseConfigured.mockReturnValue(false);
        expect((await (await GET()).json()).browserExecution).toBe("not_configured");
    });

    it("never puts the driver's own error in a public response", async () => {
        // The realistic failure: a Neon error whose message carries the
        // connection string it failed to reach.
        mocks.execute.mockRejectedValue(
            new Error("could not connect to postgresql://user:hunter2@ep-x.neon.tech/db"),
        );

        const serialised = JSON.stringify(await (await GET()).json()).toLowerCase();

        for (const shape of SECRET_SHAPES) {
            expect(serialised).not.toContain(shape.toLowerCase());
        }
    });

    it("is never cached, so a stale 200 cannot keep traffic on a dead process", async () => {
        mocks.execute.mockResolvedValue([]);

        expect((await GET()).headers.get("Cache-Control")).toBe("no-store");
    });

    it("reports the commit short, and null when the host sets none", async () => {
        mocks.execute.mockResolvedValue([]);

        // Read at module load, so this asserts the shape rather than re-reading.
        const { commit } = await (await GET()).json();

        expect(commit === null || (typeof commit === "string" && commit.length === 7)).toBe(true);
    });
});
