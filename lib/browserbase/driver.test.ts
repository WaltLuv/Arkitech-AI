import { describe, expect, it, vi } from "vitest";
import { performAction, redactCapabilities } from "./driver";

/**
 * The driver's two testable halves: how an action becomes browser calls, and
 * what an error is allowed to say. Connecting to a real session is verified
 * live, not here.
 */
function fakePage() {
    const calls: Array<[string, unknown[]]> = [];
    const record = (name: string) => async (...args: unknown[]) => { calls.push([name, args]); };
    return {
        calls,
        page: {
            mouse: { click: record("click"), move: record("move"), down: record("down"), up: record("up"), wheel: record("wheel") },
            keyboard: { press: record("press"), insertText: record("insertText") },
            setViewportSize: record("setViewportSize"),
        } as unknown as import("playwright-core").Page,
    };
}

describe("performAction", () => {
    it("clicks with the button and count it was given", async () => {
        const { page, calls } = fakePage();
        await performAction(page, { type: "click", x: 5, y: 6, button: "right", clickCount: 2 });
        expect(calls).toEqual([["click", [5, 6, { button: "right", clickCount: 2 }]]]);
    });

    it("moves to the origin before wheeling so the scroll lands on the right element", async () => {
        const { page, calls } = fakePage();
        await performAction(page, { type: "scroll", x: 1, y: 2, deltaX: 0, deltaY: 300 });
        expect(calls).toEqual([["move", [1, 2]], ["wheel", [0, 300]]]);
    });

    it("drags as press, path, release", async () => {
        const { page, calls } = fakePage();
        await performAction(page, { type: "drag", path: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }] });
        expect(calls.map(c => c[0])).toEqual(["move", "down", "move", "move", "up"]);
    });

    it("inserts text as text and presses keys as keys", async () => {
        const { page, calls } = fakePage();
        await performAction(page, { type: "text", text: "hi there" });
        await performAction(page, { type: "key", combination: "Control+a" });
        expect(calls).toEqual([["insertText", ["hi there"]], ["press", ["Control+a"]]]);
    });

    it("resizes the viewport", async () => {
        const { page, calls } = fakePage();
        await performAction(page, { type: "resize", width: 390, height: 844 });
        expect(calls).toEqual([["setViewportSize", [{ width: 390, height: 844 }]]]);
    });
});

describe("redactCapabilities", () => {
    it("removes websocket URLs, API keys and devtools paths", () => {
        const input = [
            "connectOverCDP failed for wss://connect.browserbase.com?apiKey=bb_live_abc123&sessionId=s1",
            "see https://www.browserbase.com/devtools/browser/abc for details",
            "signingKey=deadbeef apiKey=bb_test_zzz",
        ].join(" ");

        const output = redactCapabilities(input);

        expect(output).not.toMatch(/wss?:\/\//);
        expect(output).not.toContain("bb_live_abc123");
        expect(output).not.toContain("bb_test_zzz");
        expect(output).not.toContain("devtools/browser/abc");
        expect(output).not.toContain("deadbeef");
        expect(output).toContain("[redacted");
    });

    it("leaves an ordinary message alone", () => {
        expect(redactCapabilities("Timeout 20000ms exceeded")).toBe("Timeout 20000ms exceeded");
    });

    it("is what a driver error reports", async () => {
        vi.resetModules();
        const { BrowserDriverError } = await import("./driver");
        const error = new BrowserDriverError("boom at wss://x.y?apiKey=bb_live_k", "s1");
        expect(error.message).toBe("boom at [redacted-ws-url]");
        expect(error.sessionId).toBe("s1");
    });
});
