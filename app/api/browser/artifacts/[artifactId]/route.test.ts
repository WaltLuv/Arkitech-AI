import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Artifact bytes are the one route that serves stored file content, so it is
 * the one worth attacking directly: guessing an id, asking for someone else's,
 * and asking for content the server cannot vouch for.
 */
const mocks = vi.hoisted(() => ({
    currentUser: vi.fn(),
    readOwnedArtifact: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/browserbase/storage", () => ({ readOwnedArtifact: mocks.readOwnedArtifact }));

import { GET } from "./route";

const ARTIFACT = "33333333-3333-4333-8333-333333333333";

const request = new Request("http://localhost/api/browser/artifacts/x") as unknown as import("next/server").NextRequest;
const params = (id: string) => ({ params: Promise.resolve({ artifactId: id }) });

const artifact = (over: Record<string, unknown> = {}) => ({
    id: ARTIFACT,
    filename: "screenshot.png",
    mimeType: "image/png",
    sizeBytes: 3,
    checksum: "abc123",
    bytes: Buffer.from("png"),
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: "owner@example.com" } });
    mocks.readOwnedArtifact.mockResolvedValue(artifact());
});

describe("GET /api/browser/artifacts/[id]", () => {
    it("serves the owner's own artifact with its checksum", async () => {
        const response = await GET(request, params(ARTIFACT));

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toBe("image/png");
        expect(response.headers.get("X-Checksum-Sha256")).toBe("abc123");
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("png");
    });

    it("refuses an unauthenticated caller before reading anything", async () => {
        mocks.currentUser.mockResolvedValue(null);

        const response = await GET(request, params(ARTIFACT));

        expect(response.status).toBe(401);
        expect(mocks.readOwnedArtifact).not.toHaveBeenCalled();
    });

    it("scopes the read to the caller, so an id alone is never enough", async () => {
        await GET(request, params(ARTIFACT));

        expect(mocks.readOwnedArtifact).toHaveBeenCalledWith(ARTIFACT, "owner@example.com");
    });

    it("answers 404 for someone else's artifact, the same as for a missing one", async () => {
        // readOwnedArtifact returns null for both cases; the route must not
        // distinguish them, or the difference tells an attacker which ids exist.
        mocks.readOwnedArtifact.mockResolvedValue(null);

        const response = await GET(request, params(ARTIFACT));

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: "Artifact not found" });
    });

    it("rejects an id that is not a uuid without querying at all", async () => {
        for (const id of ["1", "../../etc/passwd", "%27%20OR%201=1", "not-a-uuid"]) {
            const response = await GET(request, params(id));
            expect(response.status).toBe(404);
        }
        expect(mocks.readOwnedArtifact).not.toHaveBeenCalled();
    });

    it("never renders an unexpected type inline", async () => {
        mocks.readOwnedArtifact.mockResolvedValue(artifact({ mimeType: "text/html", filename: "evil.html" }));

        const response = await GET(request, params(ARTIFACT));

        // An HTML artifact rendered inline would run as the app's own origin.
        expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
        expect(response.headers.get("Content-Disposition")).toContain("attachment");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("cannot have its filename used to forge a header", async () => {
        mocks.readOwnedArtifact.mockResolvedValue(
            artifact({ filename: 'a".png\r\nSet-Cookie: session=stolen', mimeType: "image/png" }),
        );

        const response = await GET(request, params(ARTIFACT));

        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect(response.headers.get("Content-Disposition")).not.toContain("Set-Cookie: session=stolen\r\n");
    });
});
