/**
 * Server-side control of a Browserbase session over the Chrome DevTools
 * Protocol, through playwright-core.
 *
 * This is the only module that touches the session's connect URL. That URL
 * carries the API key and grants full control of the browser, so it is read
 * from the provider per call, handed straight to the CDP client, and never
 * stored, logged, returned, or placed in an error message. Every error that
 * leaves this module passes through `redactCapabilities` first.
 *
 * Watchers and human controllers never connect themselves. They see JPEG
 * frames captured here and send actions that are validated and dispatched
 * here, after the caller has checked the control lease.
 */
import { chromium, type Browser, type Page } from "playwright-core";
import { retrieveSession } from "./client";
import type { BrowserAction, Viewport } from "./input-mapping";

const CONNECT_TIMEOUT_MS = 20_000;
const IDLE_DISCONNECT_MS = 60_000;

type Connection = { browser: Browser; lastUsed: number };

/** Warm connections, keyed by provider session id. Harmless when cold. */
const connections = new Map<string, Connection>();

/**
 * Strips anything that would let the reader of a log or an error message
 * drive the browser: websocket URLs, devtools paths, API keys in query
 * strings. Applied to every error this module rethrows.
 */
export function redactCapabilities(text: string): string {
    return text
        .replace(/wss?:\/\/[^\s"'<>]+/gi, "[redacted-ws-url]")
        .replace(/https?:\/\/[^\s"'<>]*devtools\/(browser|page)\/[^\s"'<>]*/gi, "[redacted-devtools-url]")
        .replace(/apiKey=[^&\s"'<>]+/gi, "apiKey=[redacted]")
        .replace(/\bbb_(live|test)_[A-Za-z0-9]+/g, "[redacted-key]")
        .replace(/signingKey=[^&\s"'<>]+/gi, "signingKey=[redacted]");
}

/** The message a route may show for any error at all, whatever threw it. */
export function safeErrorMessage(error: unknown, fallback = "Browser unavailable"): string {
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return redactCapabilities(message || fallback);
}

export class BrowserDriverError extends Error {
    constructor(message: string, readonly sessionId: string) {
        super(redactCapabilities(message));
        this.name = "BrowserDriverError";
    }
}

function wrap(sessionId: string, error: unknown): BrowserDriverError {
    const message = error instanceof Error ? error.message : String(error);
    return new BrowserDriverError(message, sessionId);
}

async function connect(sessionId: string): Promise<Browser> {
    const existing = connections.get(sessionId);
    if (existing && existing.browser.isConnected()) {
        existing.lastUsed = Date.now();
        return existing.browser;
    }
    connections.delete(sessionId);

    const session = await retrieveSession(sessionId);
    const connectUrl = session.connectUrl;
    if (!connectUrl) {
        throw new BrowserDriverError("Session has no connect URL; it may have ended", sessionId);
    }

    let browser: Browser;
    try {
        browser = await chromium.connectOverCDP(connectUrl, { timeout: CONNECT_TIMEOUT_MS });
    } catch (error) {
        throw wrap(sessionId, error);
    }

    browser.on("disconnected", () => {
        const current = connections.get(sessionId);
        if (current?.browser === browser) connections.delete(sessionId);
    });

    connections.set(sessionId, { browser, lastUsed: Date.now() });
    return browser;
}

/** Closes connections nobody has used for a while. Called opportunistically. */
export async function closeIdleConnections(now = Date.now()): Promise<void> {
    for (const [sessionId, connection] of connections) {
        if (now - connection.lastUsed > IDLE_DISCONNECT_MS) {
            connections.delete(sessionId);
            await connection.browser.close().catch(() => undefined);
        }
    }
}

export async function disconnectSession(sessionId: string): Promise<void> {
    const connection = connections.get(sessionId);
    connections.delete(sessionId);
    if (connection) await connection.browser.close().catch(() => undefined);
}

/**
 * The tab the person or the agent is looking at: the most recently opened one
 * that is still open. A popup therefore becomes the current tab, which is
 * what a person expects, and which site policy checks separately.
 */
async function currentPage(browser: Browser, sessionId: string): Promise<Page> {
    const context = browser.contexts()[0];
    if (!context) throw new BrowserDriverError("Session has no browser context", sessionId);

    const pages = context.pages().filter(page => !page.isClosed());
    if (pages.length === 0) return context.newPage();

    return pages[pages.length - 1];
}

export async function withPage<T>(sessionId: string, fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await connect(sessionId);
    const page = await currentPage(browser, sessionId);
    try {
        return await fn(page);
    } catch (error) {
        throw wrap(sessionId, error);
    } finally {
        void closeIdleConnections();
    }
}

export type Frame = {
    jpeg: Buffer;
    url: string;
    title: string;
    viewport: Viewport;
    tabCount: number;
};

/** One JPEG of the current tab plus what the person needs to know about it. */
export async function captureFrame(sessionId: string, quality = 60): Promise<Frame> {
    return withPage(sessionId, async page => {
        const jpeg = await page.screenshot({ type: "jpeg", quality, fullPage: false });
        const viewport = page.viewportSize() ?? { width: 0, height: 0 };
        const tabCount = page.context().pages().filter(p => !p.isClosed()).length;
        const title = await page.title().catch(() => "");
        return { jpeg, url: page.url(), title, viewport, tabCount };
    });
}

/** A PNG for the agent, which is what the computer tool expects. */
export async function capturePng(sessionId: string): Promise<{ png: Buffer; url: string; title: string }> {
    return withPage(sessionId, async page => {
        const png = await page.screenshot({ type: "png", fullPage: false });
        const title = await page.title().catch(() => "");
        return { png, url: page.url(), title };
    });
}

export async function currentViewport(sessionId: string): Promise<Viewport | null> {
    return withPage(sessionId, async page => page.viewportSize());
}

export async function setViewport(sessionId: string, viewport: Viewport): Promise<void> {
    await withPage(sessionId, page => page.setViewportSize(viewport));
}

export async function currentLocation(sessionId: string): Promise<{ url: string; title: string; tabCount: number }> {
    return withPage(sessionId, async page => ({
        url: page.url(),
        title: await page.title().catch(() => ""),
        tabCount: page.context().pages().filter(p => !p.isClosed()).length,
    }));
}

/**
 * Executes one already-validated action. Coordinates are viewport pixels;
 * nothing here re-checks authorisation, which is the caller's job and is
 * done against the lease before this is reached.
 */
export async function dispatchAction(sessionId: string, action: BrowserAction): Promise<void> {
    await withPage(sessionId, page => performAction(page, action));
}

/** Exposed for tests, which drive it with a fake page. */
export async function performAction(page: Page, action: BrowserAction): Promise<void> {
    switch (action.type) {
        case "click":
            await page.mouse.click(action.x, action.y, {
                button: action.button,
                clickCount: action.clickCount,
            });
            return;

        case "move":
            await page.mouse.move(action.x, action.y);
            return;

        case "drag": {
            const [first, ...rest] = action.path;
            await page.mouse.move(first.x, first.y);
            await page.mouse.down();
            for (const point of rest) await page.mouse.move(point.x, point.y);
            await page.mouse.up();
            return;
        }

        case "scroll":
            await page.mouse.move(action.x, action.y);
            await page.mouse.wheel(action.deltaX, action.deltaY);
            return;

        case "key":
            await page.keyboard.press(action.combination);
            return;

        case "text":
            await page.keyboard.insertText(action.text);
            return;

        case "resize":
            await page.setViewportSize({ width: action.width, height: action.height });
            return;
    }
}

/** Navigation is a separate verb so site policy can sit in front of it. */
export async function navigateTo(sessionId: string, url: string): Promise<void> {
    await withPage(sessionId, async page => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    });
}
