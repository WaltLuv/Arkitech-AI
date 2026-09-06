import { describe, expect, it, vi } from "vitest";

describe("browserbase client without credentials", () => {
    it("reports itself unconfigured and refuses to create a session", async () => {
        vi.stubEnv("BROWSERBASE_API_KEY", "");
        vi.stubEnv("BROWSERBASE_PROJECT_ID", "");

        const m = await import("@/lib/browserbase/client");

        expect(m.isBrowserbaseConfigured()).toBe(false);
        await expect(m.createSession({ creationKey: "k" })).rejects.toThrow(
            /Browser execution is not configured/,
        );
    });

    it("names the missing variables on the error", async () => {
        vi.stubEnv("BROWSERBASE_API_KEY", "");
        vi.stubEnv("BROWSERBASE_PROJECT_ID", "");

        const m = await import("@/lib/browserbase/client");
        const error = await m.createSession({ creationKey: "k" }).catch(e => e);

        expect(error.name).toBe("BrowserbaseNotConfiguredError");
        expect(error.missing).toEqual(["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"]);
    });

    it("becomes configured once both values are present", async () => {
        vi.stubEnv("BROWSERBASE_API_KEY", "bb_live_x");
        vi.stubEnv("BROWSERBASE_PROJECT_ID", "proj_1");

        const m = await import("@/lib/browserbase/client");

        expect(m.isBrowserbaseConfigured()).toBe(true);
    });
});
