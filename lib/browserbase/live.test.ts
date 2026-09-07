import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Live verification against a real Browserbase session.
 *
 * Everything else in this directory proves behaviour offline. This file proves
 * the parts that only a real provider can answer: that the credentials work,
 * that a session can be created and driven over CDP, that site policy actually
 * blocks a real request, that input actually lands, and that the session is
 * actually released afterwards.
 *
 * It costs money, so it is skipped unless asked for, and it creates exactly one
 * session and releases it in afterAll whatever happens.
 *
 *     set -a && . ./.env.local && set +a
 *     LIVE_BROWSERBASE=1 npx vitest run lib/browserbase/live.test.ts
 *
 * The database is deliberately untouched: this is about the provider, and
 * requiring DATABASE_URL would make a provider check fail for the wrong reason.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createSession, isBrowserbaseConfigured, releaseSession, retrieveSession } from "./client";
import { performAction, redactCapabilities } from "./driver";
import { AGENT_VIEWPORT, classifyTouch, mapClientAction, touchGestureToAction } from "./input-mapping";
import { SiteGuard } from "./site-guard";
import { evaluateUrl, type DenyReason } from "./site-policy";

const live = process.env.LIVE_BROWSERBASE === "1";

/** A public page that is stable, tiny, and safe to click around on. */
const ALLOWED_URL = "https://example.com/";
/** The address every cloud provider exposes internally. Must never load. */
const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

let sessionId = "";
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

const blocked: Array<{ url: string; reason: DenyReason; stage: string }> = [];
const navigated: string[] = [];

describe.skipIf(!live)("live Browserbase session", () => {
    beforeAll(async () => {
        expect(isBrowserbaseConfigured(), "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set").toBe(true);

        const created = await createSession({ creationKey: `arkitech-live-${Date.now()}` });
        sessionId = created.id;

        const record = await retrieveSession(sessionId);
        expect(record.connectUrl, "the provider must return a connect URL").toBeTruthy();

        browser = await chromium.connectOverCDP(record.connectUrl as string, { timeout: 30_000 });
        context = browser.contexts()[0];
        expect(context, "the session must expose a browser context").toBeTruthy();

        // The same guard the worker installs, with a policy that allows public
        // sites. Private ranges are refused by the policy itself, not by a rule.
        const guard = new SiteGuard(
            { allowPublic: true, allowedHosts: [] },
            {
                events: {
                    onBlocked: info => blocked.push({ url: info.url, reason: info.reason, stage: info.stage }),
                    onNavigated: info => navigated.push(info.url),
                },
            },
        );
        await guard.attach(context as unknown as Parameters<SiteGuard["attach"]>[0]);

        page = context!.pages().find(p => !p.isClosed()) ?? (await context!.newPage());
        await page.setViewportSize(AGENT_VIEWPORT);
    }, 120_000);

    afterAll(async () => {
        // Release first and always: an unreleased session keeps costing money.
        if (browser) await browser.close().catch(() => undefined);
        if (sessionId) {
            await releaseSession(sessionId).catch(() => undefined);
            const after = await retrieveSession(sessionId).catch(() => null);
            // Reported rather than asserted: release is a request, and the
            // provider may still be tearing down when this runs.
            console.log(`[live] session ${sessionId} final status: ${after?.status ?? "unknown"}`);
        }
    }, 120_000);

    it("loads a permitted public page", async () => {
        await page!.goto(ALLOWED_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        expect(page!.url()).toContain("example.com");
        expect(await page!.title()).toBeTruthy();
    }, 60_000);

    it("captures a real screenshot the server can serve as a frame", async () => {
        const jpeg = await page!.screenshot({ type: "jpeg", quality: 60, fullPage: false });

        // A real JPEG, not an empty buffer or an error page of zero bytes.
        expect(jpeg.byteLength).toBeGreaterThan(1000);
        expect(jpeg[0]).toBe(0xff);
        expect(jpeg[1]).toBe(0xd8);
    }, 60_000);

    it("blocks a metadata endpoint on a real request, not just in the evaluator", async () => {
        blocked.length = 0;

        await page!.goto(METADATA_URL, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);

        // The evaluator's verdict, and the guard's behaviour on a live request.
        expect(evaluateUrl(METADATA_URL, { allowPublic: true, allowedHosts: [] })).toMatchObject({ allowed: false });
        expect(blocked.some(b => b.url.includes("169.254.169.254"))).toBe(true);
        expect(page!.url()).not.toContain("169.254.169.254");
    }, 60_000);

    it("accepts a desktop click mapped from a rendered frame", async () => {
        await page!.goto(ALLOWED_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // A click at the centre of a 640x400 rendering of a 1280x800 viewport.
        const mapped = mapClientAction(
            { type: "click", x: 320, y: 200 },
            { width: 640, height: 400 },
            AGENT_VIEWPORT,
        );
        expect(mapped.ok).toBe(true);
        if (!mapped.ok) return;
        expect(mapped.action).toMatchObject({ type: "click", x: 640, y: 400 });

        await performAction(page!, mapped.action);
    }, 60_000);

    it("types real text and presses real keys into a real page", async () => {
        await page!.setContent(`<input id="field" autofocus />`);
        await page!.focus("#field");

        const text = mapClientAction({ type: "text", text: "arkitech" }, AGENT_VIEWPORT, AGENT_VIEWPORT);
        expect(text.ok).toBe(true);
        if (text.ok) await performAction(page!, text.action);

        expect(await page!.inputValue("#field")).toBe("arkitech");

        // A named key, through the same whitelist the human path uses.
        const key = mapClientAction({ type: "key", key: "Backspace" }, AGENT_VIEWPORT, AGENT_VIEWPORT);
        expect(key.ok).toBe(true);
        if (key.ok) await performAction(page!, key.action);

        expect(await page!.inputValue("#field")).toBe("arkitec");
    }, 60_000);

    it("scrolls a real page from a touch pan", async () => {
        await page!.setContent(`<body style="margin:0"><div style="height:5000px">tall</div></body>`);
        expect(await page!.evaluate(() => window.scrollY)).toBe(0);

        // A finger dragged up by 200 rendered pixels on a 360-wide phone view.
        const gesture = classifyTouch({ x: 180, y: 400 }, { x: 180, y: 200 }, 250);
        expect(gesture).toMatchObject({ type: "pan" });

        const mapped = mapClientAction(touchGestureToAction(gesture!), { width: 360, height: 640 }, AGENT_VIEWPORT);
        expect(mapped.ok).toBe(true);
        if (mapped.ok) await performAction(page!, mapped.action);

        await page!.waitForFunction(() => window.scrollY > 0, undefined, { timeout: 10_000 });
        expect(await page!.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }, 60_000);

    it("resizes a real browser to a phone-shaped viewport and back", async () => {
        const resize = mapClientAction({ type: "resize", width: 390, height: 844 }, AGENT_VIEWPORT, AGENT_VIEWPORT);
        expect(resize.ok).toBe(true);
        if (resize.ok) await performAction(page!, resize.action);

        expect(page!.viewportSize()).toEqual({ width: 390, height: 844 });

        await page!.setViewportSize(AGENT_VIEWPORT);
        expect(page!.viewportSize()).toEqual(AGENT_VIEWPORT);
    }, 60_000);

    it("has a connect URL that would be redacted if it ever escaped", async () => {
        const record = await retrieveSession(sessionId);
        const connectUrl = String(record.connectUrl ?? "");

        expect(connectUrl).toBeTruthy();
        // The real URL, through the real redactor: no websocket URL survives.
        expect(redactCapabilities(`failed at ${connectUrl}`)).not.toContain(connectUrl);
        expect(redactCapabilities(`failed at ${connectUrl}`)).not.toMatch(/wss?:\/\//);
        expect(redactCapabilities(`failed at ${connectUrl}`)).not.toContain(process.env.BROWSERBASE_API_KEY ?? "@@none@@");
    }, 60_000);

    it("records the navigations it allowed", async () => {
        expect(navigated.some(url => url.includes("example.com"))).toBe(true);
    }, 60_000);
});
