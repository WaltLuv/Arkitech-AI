import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Live verification against a real Browserbase session.
 *
 * Everything else in this directory proves behaviour offline. This file proves
 * the parts only a real provider can answer: that the credentials work, that a
 * session is created and driven over CDP, that Arkitech's own site guard blocks
 * a real request, that mapped input actually lands where it was mapped, and
 * that the session is actually released afterwards.
 *
 * It costs money, so it is skipped unless asked for. It creates exactly one
 * session and releases it in teardown whatever happens, including when an
 * assertion fails or setup dies part-way through.
 *
 *     set -a && . ./.env.local && set +a
 *     LIVE_BROWSERBASE=1 npx vitest run lib/browserbase/live.test.ts
 *
 * Two rules govern everything below.
 *
 * First, no secret may reach the output. A failing `expect(a).not.toContain(b)`
 * prints both operands, so any assertion about the connect URL is made on a
 * boolean computed beforehand, never on the URL itself. Provider errors are
 * redacted before they are allowed to propagate, because an unhandled SDK error
 * in CI prints straight to the log.
 *
 * Second, nothing consequential happens. The only external page fetched is
 * example.com, which exists to be fetched. Input is exercised against pages
 * this test writes itself, so a click cannot follow a link, submit a form, or
 * reach anyone's account.
 *
 * The database is deliberately untouched. This is a check on the provider, and
 * requiring DATABASE_URL would let it fail for the wrong reason.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createSession, isBrowserbaseConfigured, releaseSession, retrieveSession } from "./client";
import { performAction, redactCapabilities } from "./driver";
import { AGENT_VIEWPORT, classifyTouch, mapClientAction, touchGestureToAction } from "./input-mapping";
import { SiteGuard } from "./site-guard";
import { evaluateUrl, type DenyReason } from "./site-policy";

const live = process.env.LIVE_BROWSERBASE === "1";

/** A public page that exists to be fetched. Nothing here is consequential. */
const ALLOWED_URL = "https://example.com/";
/** The address every cloud provider exposes internally. Must never load. */
const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

const PROVIDER_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 30_000;

let sessionId = "";
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let connectUrlSeen = false;

const blocked: Array<{ url: string; reason: DenyReason; stage: string }> = [];
const navigated: string[] = [];

/** Nothing waits forever, including a provider call the SDK would let hang. */
function withTimeout<T>(work: Promise<T>, label: string, ms = PROVIDER_TIMEOUT_MS): Promise<T> {
    return Promise.race([
        work,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms`)), ms).unref?.(),
        ),
    ]);
}

/**
 * Every provider call goes through here. An SDK error can carry the request
 * URL, and the request URL carries the API key; letting one propagate raw
 * would print it into the CI log.
 */
async function provider<T>(label: string, work: () => Promise<T>): Promise<T> {
    try {
        return await withTimeout(work(), label);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = (error as { status?: number }).status;
        throw new Error(
            `${label} failed${status ? ` with status ${status}` : ""}: ${redactCapabilities(message).slice(0, 300)}`,
        );
    }
}


/**
 * Writes a controlled page, from a settled starting point.
 *
 * The guard's second line sends a refused page to about:blank, and it does so
 * from a framenavigated handler rather than in step with the caller. That
 * recovery can therefore land while the next thing is writing content, which
 * destroys the execution context mid-write. Going to about:blank first makes
 * the starting point explicit, and one retry absorbs a recovery that was
 * already in flight.
 */
async function writePage(html: string): Promise<void> {
    await page!.goto("about:blank", { waitUntil: "load", timeout: 15_000 }).catch(() => undefined);
    try {
        await page!.setContent(html, { waitUntil: "load", timeout: 15_000 });
    } catch (error) {
        if (!/Execution context was destroyed/i.test(String((error as Error).message))) throw error;
        await page!.setContent(html, { waitUntil: "load", timeout: 15_000 });
    }
}

describe.skipIf(!live)("live Browserbase session", () => {
    beforeAll(async () => {
        expect(isBrowserbaseConfigured(), "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must both be set").toBe(true);

        // Assigned before anything else can throw, so teardown always has an
        // id to release even if the steps below fail.
        const created = await provider("createSession", () =>
            createSession({ creationKey: `arkitech-live-${Date.now()}` }));
        sessionId = created.id;

        const record = await provider("retrieveSession", () => retrieveSession(sessionId));
        const connectUrl = String(record.connectUrl ?? "");
        connectUrlSeen = connectUrl.length > 0;
        expect(connectUrlSeen, "the provider must return a connect URL").toBe(true);

        browser = await provider("connectOverCDP", () =>
            chromium.connectOverCDP(connectUrl, { timeout: CONNECT_TIMEOUT_MS }));

        context = browser.contexts()[0] ?? null;
        expect(context, "the session must expose a browser context").not.toBeNull();

        // The same guard the worker installs, with a policy that allows public
        // sites. Private ranges are refused by the policy itself, not by a rule,
        // so this configuration cannot accidentally permit the metadata test.
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
        page.setDefaultTimeout(NAV_TIMEOUT_MS);
        await page.setViewportSize(AGENT_VIEWPORT);
    }, 180_000);

    afterAll(async () => {
        // Release first and always: an unreleased session keeps costing money.
        if (browser) await browser.close().catch(() => undefined);

        if (sessionId) {
            const released = await releaseSession(sessionId).then(() => true).catch(() => false);
            const after = await retrieveSession(sessionId).catch(() => null);
            // Reported, not asserted: release is a request, and the provider
            // may still be tearing down when this runs. The session id is an
            // identifier, not a capability; it is useless without the API key.
            console.log(
                `[live] session ${sessionId}: release requested=${released}, provider status=${after?.status ?? "unknown"}`,
            );
        }
    }, 180_000);

    it("loads a permitted public page", async () => {
        await page!.goto(ALLOWED_URL, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });

        expect(page!.url()).toContain("example.com");
        expect(await page!.title()).toBeTruthy();
    }, 90_000);

    it("captures a real screenshot whose bytes are actually a JPEG", async () => {
        const jpeg = await page!.screenshot({ type: "jpeg", quality: 60, fullPage: false });

        expect(jpeg.byteLength).toBeGreaterThan(1000);
        // SOI marker, and the EOI marker that only a complete JPEG carries.
        expect(jpeg[0]).toBe(0xff);
        expect(jpeg[1]).toBe(0xd8);
        expect(jpeg[jpeg.byteLength - 2]).toBe(0xff);
        expect(jpeg[jpeg.byteLength - 1]).toBe(0xd9);
    }, 90_000);

    it("lands a mapped desktop click on the exact pixel it was mapped to", async () => {
        // A page this test writes, so a click cannot follow a link anywhere.
        await writePage(`
            <body style="margin:0">
              <div id="pad" style="width:100vw;height:100vh"></div>
              <script>
                window.__click = null;
                document.getElementById("pad").addEventListener("click", e => {
                  window.__click = { x: e.clientX, y: e.clientY, button: e.button };
                });
              </script>
            </body>`);

        // The centre of a 640x400 rendering of the 1280x800 agent viewport.
        const mapped = mapClientAction({ type: "click", x: 320, y: 200 }, { width: 640, height: 400 }, AGENT_VIEWPORT);
        expect(mapped.ok).toBe(true);
        if (!mapped.ok) return;
        expect(mapped.action).toMatchObject({ type: "click", x: 640, y: 400 });

        await performAction(page!, mapped.action);

        const landed = await page!.evaluate(() => (window as unknown as { __click: unknown }).__click);
        expect(landed).toEqual({ x: 640, y: 400, button: 0 });
    }, 90_000);

    it("types real text and presses a real key into a real page", async () => {
        await writePage(`<body style="margin:0"><input id="field" /></body>`);
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
    }, 90_000);

    it("scrolls a real page from a phone-sized touch pan", async () => {
        await writePage(`<body style="margin:0"><div style="height:5000px">tall</div></body>`);
        expect(await page!.evaluate(() => window.scrollY)).toBe(0);

        // A finger dragged up by 200 rendered pixels on a 360-wide phone view.
        const gesture = classifyTouch({ x: 180, y: 400 }, { x: 180, y: 200 }, 250);
        expect(gesture).toMatchObject({ type: "pan" });

        const mapped = mapClientAction(touchGestureToAction(gesture!), { width: 360, height: 640 }, AGENT_VIEWPORT);
        expect(mapped.ok).toBe(true);
        if (mapped.ok) await performAction(page!, mapped.action);

        await page!.waitForFunction(() => window.scrollY > 0, undefined, { timeout: 10_000 });
        expect(await page!.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }, 90_000);

    it("resizes a real browser to a phone-shaped viewport and back", async () => {
        const resize = mapClientAction({ type: "resize", width: 390, height: 844 }, AGENT_VIEWPORT, AGENT_VIEWPORT);
        expect(resize.ok).toBe(true);
        if (resize.ok) await performAction(page!, resize.action);

        expect(page!.viewportSize()).toEqual({ width: 390, height: 844 });

        await page!.setViewportSize(AGENT_VIEWPORT);
        expect(page!.viewportSize()).toEqual(AGENT_VIEWPORT);
    }, 90_000);

    it("redacts the session's own real connect URL and API key", async () => {
        const record = await provider("retrieveSession", () => retrieveSession(sessionId));
        const connectUrl = String(record.connectUrl ?? "");
        const apiKey = process.env.BROWSERBASE_API_KEY ?? "";

        expect(connectUrl.length, "the provider must return a connect URL").toBeGreaterThan(0);
        expect(apiKey.length, "the API key must be present to prove it is redacted").toBeGreaterThan(0);

        const redacted = redactCapabilities(`connect failed at ${connectUrl}`);

        // Every assertion below is on a boolean computed here. Passing the URL
        // or the key into expect() would print it on failure, which is the one
        // way this test could leak the thing it exists to protect.
        const stillHasUrl = redacted.includes(connectUrl);
        const stillHasScheme = /wss?:\/\//.test(redacted);
        const stillHasKey = redacted.includes(apiKey);

        expect(stillHasUrl, "the connect URL survived redaction").toBe(false);
        expect(stillHasScheme, "a websocket scheme survived redaction").toBe(false);
        expect(stillHasKey, "the API key survived redaction").toBe(false);
        expect(redacted).toContain("[redacted");
    }, 90_000);

    // Deliberately after the input tests. Blocking navigates the page to
    // about:blank as a second line, asynchronously, and that recovery landing
    // mid-write is what broke the click test on the first live run.
    it("blocks a metadata endpoint by Arkitech's own guard, on a real request", async () => {
        blocked.length = 0;

        await page!.goto(METADATA_URL, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);

        // Arkitech's verdict, named. A provider that happened to refuse the
        // route as well would not produce this: only our guard records it.
        const ours = blocked.find(b => b.url.includes("169.254.169.254"));
        expect(ours, "Arkitech's guard must be the thing that refused it").toBeDefined();
        expect(ours!.reason).toBe("metadata_endpoint");

        // And the evaluator agrees, independently of what the network did.
        expect(evaluateUrl(METADATA_URL, { allowPublic: true, allowedHosts: [] }))
            .toMatchObject({ allowed: false, reason: "metadata_endpoint" });

        expect(page!.url()).not.toContain("169.254.169.254");
    }, 90_000);

    it("recorded the navigations it allowed", async () => {
        expect(connectUrlSeen).toBe(true);
        expect(navigated.some(url => url.includes("example.com"))).toBe(true);
    }, 90_000);
});
