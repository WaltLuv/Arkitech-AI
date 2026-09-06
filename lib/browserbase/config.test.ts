import { describe, expect, it } from "vitest";
import { missingConfigMessage, readBrowserbaseConfig } from "@/lib/browserbase/config";

const env = (over: Record<string, string | undefined>) => over as NodeJS.ProcessEnv;

describe("readBrowserbaseConfig", () => {
    it("accepts a complete configuration", () => {
        const result = readBrowserbaseConfig(env({
            BROWSERBASE_API_KEY: "bb_live_x",
            BROWSERBASE_PROJECT_ID: "proj_1",
        }));

        expect(result).toEqual({ ok: true, config: { apiKey: "bb_live_x", projectId: "proj_1" } });
    });

    it("names exactly what is missing, so the operator is not left guessing", () => {
        const result = readBrowserbaseConfig(env({}));

        expect(result).toEqual({
            ok: false,
            missing: ["BROWSERBASE_API_KEY", "BROWSERBASE_PROJECT_ID"],
        });
    });

    it("reports a single missing value on its own", () => {
        const result = readBrowserbaseConfig(env({ BROWSERBASE_API_KEY: "bb_live_x" }));

        expect(result).toEqual({ ok: false, missing: ["BROWSERBASE_PROJECT_ID"] });
    });

    it("treats blank and whitespace values as missing rather than valid", () => {
        const result = readBrowserbaseConfig(env({
            BROWSERBASE_API_KEY: "   ",
            BROWSERBASE_PROJECT_ID: "",
        }));

        expect(result.ok).toBe(false);
    });

    it("ignores BROWSERBASE_AGENT_ID, which belongs to the hosted research tool", () => {
        // Session-based execution does not use it. Accepting it here would
        // suggest the subsystem is configured when it is not.
        const result = readBrowserbaseConfig(env({ BROWSERBASE_AGENT_ID: "agent_1" }));

        expect(result).toMatchObject({ ok: false });
    });

    it("does not read configuration from anywhere but the environment given", () => {
        // Passing an explicit env is what stops a request influencing which
        // project or key is used.
        const result = readBrowserbaseConfig(env({}));

        expect(result.ok).toBe(false);
    });

    it("produces an actionable message", () => {
        expect(missingConfigMessage(["BROWSERBASE_API_KEY"]))
            .toBe("Browser execution is not configured. Missing: BROWSERBASE_API_KEY.");
    });
});
