import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
    db: {
        execute: vi.fn(async () => ({ rows: [{ sequence: 1 }] })),
        insert: () => ({ values: (v: unknown) => ({ returning: async () => [v] }) }),
    },
    browserEvent: {},
    browserArtifact: {},
}));
vi.mock("drizzle-orm", () => ({ sql: Object.assign(() => ({}), { raw: () => ({}) }) }));

import {
    UnsafeActivityDetailError,
    assertSafeDetail,
    checksumOf,
    recordArtifact,
} from "@/lib/browserbase/activity";

describe("assertSafeDetail", () => {
    it("accepts ordinary structured metadata", () => {
        expect(() => assertSafeDetail({
            url: "https://example.com/orders",
            action: "click",
            selector: "#submit",
            durationMs: 120,
            nested: { pageTitle: "Orders" },
        })).not.toThrow();
    });

    it.each([
        ["password", { password: "hunter2" }],
        ["cookie", { cookie: "session=abc" }],
        ["apiKey", { apiKey: "x" }],
        ["authorization", { authorization: "Bearer x" }],
        ["debuggerUrl", { debuggerUrl: "https://x" }],
        ["wsUrl", { wsUrl: "wss://x" }],
        ["reasoning", { reasoning: "first I considered" }],
        ["nested credential", { outer: { credentials: "x" } }],
        ["key with punctuation", { "api-key": "x" }],
    ])("refuses a forbidden key: %s", (_label, detail) => {
        expect(() => assertSafeDetail(detail)).toThrow(UnsafeActivityDetailError);
    });

    it.each([
        ["a websocket URL", { note: "connect to wss://connect.browserbase.com/x" }],
        ["a devtools endpoint", { note: "https://x/devtools/browser/abc" }],
        ["a Browserbase-style key", { note: "bb_live_abc123" }],
        ["a provider secret", { note: "sk-abcdefghij" }],
        ["a signed URL", { note: "https://x/a.png?X-Amz-Signature=abc" }],
    ])("refuses a forbidden value shape: %s", (_label, detail) => {
        expect(() => assertSafeDetail(detail)).toThrow(UnsafeActivityDetailError);
    });

    it("screens inside arrays, not just objects", () => {
        expect(() => assertSafeDetail({ steps: [{ ok: true }, { token: "x" }] }))
            .toThrow(UnsafeActivityDetailError);
    });

    it("throws rather than silently stripping", () => {
        // Stripping would leave the caller believing it was recorded and the
        // next reader believing the trail is complete.
        let detail: Record<string, unknown> = { cookie: "c" };
        expect(() => assertSafeDetail(detail)).toThrow();
        expect(detail.cookie).toBe("c");
    });

    it("names what it objected to, so the caller can fix it", () => {
        expect(() => assertSafeDetail({ outer: { wsUrl: "x" } }))
            .toThrow(/outer\.wsUrl/);
    });

    it("tolerates null and undefined", () => {
        expect(() => assertSafeDetail(null)).not.toThrow();
        expect(() => assertSafeDetail(undefined)).not.toThrow();
    });
});

describe("artifacts", () => {
    it("checksums the bytes it stores", () => {
        expect(checksumOf(new TextEncoder().encode("hello"))).toBe(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
    });

    it("is verified only when the bytes are actually held", async () => {
        const artifact = await recordArtifact({
            browserRunId: "r", userEmail: "u@e.com", source: "screenshot",
            bytes: new TextEncoder().encode("png"), storageKey: "s3://k",
        });

        expect(artifact).toMatchObject({ verificationState: "verified" });
        expect(artifact.checksum).toHaveLength(64);
        expect(artifact.sizeBytes).toBe(3);
    });

    it("stays pending when there is only a pointer, not bytes", async () => {
        // A provider URL is somebody else's storage with its own retention.
        const artifact = await recordArtifact({
            browserRunId: "r", userEmail: "u@e.com", source: "recording",
        });

        expect(artifact).toMatchObject({ verificationState: "pending", checksum: null });
    });

    it("does not treat a storage key alone as evidence", async () => {
        const artifact = await recordArtifact({
            browserRunId: "r", userEmail: "u@e.com", source: "download", storageKey: "s3://k",
        });

        expect(artifact).toMatchObject({ verificationState: "pending" });
    });
});
