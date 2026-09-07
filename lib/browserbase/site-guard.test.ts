import { describe, expect, it } from "vitest";
import { SiteGuard, type GuardCdp, type GuardContext, type GuardDownload, type GuardFrame, type GuardPage } from "./site-guard";
import type { SitePolicy } from "./site-policy";

/**
 * The guard against a fake browser: requests are paused through it, frames
 * navigate under it, popups appear beside it. What these prove is that a
 * disallowed destination is refused at the request, at the redirect hop, in
 * a popup, and on the frame, and that an allowed one is let through.
 */
type Sent = { method: string; params?: Record<string, unknown> };

function fakeCdp() {
    const sent: Sent[] = [];
    const handlers = new Map<string, Array<(p: unknown) => void>>();
    const cdp: GuardCdp = {
        send: async (method, params) => { sent.push({ method, params }); },
        on: (event, handler) => { handlers.set(event, [...(handlers.get(event) ?? []), handler as (p: unknown) => void]); },
    };
    const emit = async (event: string, payload: unknown) => {
        for (const h of handlers.get(event) ?? []) await h(payload);
        // Handlers are fire-and-forget; give their promises a tick to settle.
        await new Promise(r => setTimeout(r, 0));
    };
    return { cdp, sent, emit };
}

function fakePage(initialUrl = "about:blank") {
    let url = initialUrl;
    const gotos: string[] = [];
    const frame: GuardFrame = { url: () => url };
    const handlers = new Map<string, Array<(p: unknown) => void>>();
    const page: GuardPage = {
        url: () => url,
        isClosed: () => false,
        mainFrame: () => frame,
        on: ((event: string, handler: (p: unknown) => void) => {
            handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        }) as GuardPage["on"],
        goto: async target => { gotos.push(target); url = target; },
    };
    const navigate = async (to: string) => {
        url = to;
        for (const h of handlers.get("framenavigated") ?? []) await h(frame);
        await new Promise(r => setTimeout(r, 0));
    };
    const download = async (d: GuardDownload) => {
        for (const h of handlers.get("download") ?? []) await h(d);
    };
    return { page, gotos, navigate, download, frame };
}

function fakeContext(pages: GuardPage[], cdpFor: (page: GuardPage) => GuardCdp) {
    const pageHandlers: Array<(page: GuardPage) => void> = [];
    const context: GuardContext = {
        pages: () => pages,
        on: (_event, handler) => { pageHandlers.push(handler); },
        newCDPSession: async page => cdpFor(page),
    };
    const openPopup = async (page: GuardPage) => {
        for (const h of pageHandlers) h(page);
        await new Promise(r => setTimeout(r, 5));
    };
    return { context, openPopup };
}

const restricted: SitePolicy = { allowPublic: false, allowedHosts: ["example.com"] };

async function setup(policy: SitePolicy = restricted, options: ConstructorParameters<typeof SiteGuard>[1] = {}) {
    const blocked: unknown[] = [];
    const navigated: unknown[] = [];
    const downloads: unknown[] = [];
    const guard = new SiteGuard(policy, {
        ...options,
        events: {
            onBlocked: info => blocked.push(info),
            onNavigated: info => navigated.push(info),
            onDownload: (d, popup) => downloads.push({ name: d.suggestedFilename(), popup }),
        },
    });
    const main = fakePage();
    const mainCdp = fakeCdp();
    const cdps = new Map<GuardPage, ReturnType<typeof fakeCdp>>([[main.page, mainCdp]]);
    const ctx = fakeContext([main.page], page => {
        let entry = cdps.get(page);
        if (!entry) { entry = fakeCdp(); cdps.set(page, entry); }
        return entry.cdp;
    });
    await guard.attach(ctx.context);
    return { guard, main, mainCdp, cdps, ctx, blocked, navigated, downloads };
}

describe("SiteGuard request interception", () => {
    it("enables interception on every existing page before any request", async () => {
        const { mainCdp } = await setup();
        expect(mainCdp.sent[0]).toEqual({ method: "Fetch.enable", params: { patterns: [{ urlPattern: "*", requestStage: "Request" }] } });
    });

    it("continues an allowed request and fails a disallowed one", async () => {
        const { mainCdp, blocked } = await setup();
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "https://app.example.com/api" } });
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r2", request: { url: "https://tracker.other.com/pixel" } });

        expect(mainCdp.sent.slice(1)).toEqual([
            { method: "Fetch.continueRequest", params: { requestId: "r1" } },
            { method: "Fetch.failRequest", params: { requestId: "r2", errorReason: "BlockedByClient" } },
        ]);
        expect(blocked).toEqual([expect.objectContaining({ host: "tracker.other.com", reason: "not_in_policy", stage: "request", redirected: false })]);
    });

    it("refuses a redirect hop to a disallowed host rather than following it", async () => {
        const { mainCdp, blocked } = await setup();
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "https://example.com/go" } });
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r2", request: { url: "http://169.254.169.254/latest/meta-data/" }, redirectedRequestId: "r1" });

        expect(mainCdp.sent.at(-1)).toEqual({ method: "Fetch.failRequest", params: { requestId: "r2", errorReason: "BlockedByClient" } });
        expect(blocked).toEqual([expect.objectContaining({ reason: "metadata_endpoint", redirected: true })]);
    });

    it("blocks private, loopback and metadata destinations under a fully open policy", async () => {
        const { mainCdp, blocked } = await setup({ allowPublic: true, allowedHosts: [] });
        for (const url of ["http://10.0.0.1/", "http://localhost:5432/", "http://metadata.google.internal/", "http://[::1]/", "file:///etc/passwd"]) {
            await mainCdp.emit("Fetch.requestPaused", { requestId: url, request: { url } });
        }
        expect(mainCdp.sent.filter(s => s.method === "Fetch.failRequest")).toHaveLength(5);
        expect(mainCdp.sent.filter(s => s.method === "Fetch.continueRequest")).toHaveLength(0);
        expect(blocked.map(b => (b as { reason: string }).reason)).toEqual([
            "private_network", "loopback", "metadata_endpoint", "loopback", "unsupported_scheme",
        ]);
    });

    it("refuses a listed host that resolves to a private address", async () => {
        const { mainCdp, blocked } = await setup(restricted, {
            resolve: async host => (host === "example.com" ? ["10.1.2.3"] : []),
        });
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "https://example.com/" } });
        expect(mainCdp.sent.at(-1)).toEqual({ method: "Fetch.failRequest", params: { requestId: "r1", errorReason: "BlockedByClient" } });
        expect(blocked[0]).toMatchObject({ reason: "private_network" });
    });

    it("still applies the name rules when resolution fails", async () => {
        const { mainCdp } = await setup(restricted, { resolve: async () => { throw new Error("dns down"); } });
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "https://example.com/" } });
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r2", request: { url: "https://other.com/" } });
        expect(mainCdp.sent.slice(1).map(s => s.method)).toEqual(["Fetch.continueRequest", "Fetch.failRequest"]);
    });

    it("resolves each host once", async () => {
        let calls = 0;
        const { mainCdp } = await setup(restricted, { resolve: async () => { calls++; return ["93.184.216.34"]; } });
        for (let i = 0; i < 5; i++) {
            await mainCdp.emit("Fetch.requestPaused", { requestId: `r${i}`, request: { url: `https://example.com/${i}` } });
        }
        expect(calls).toBe(1);
        expect(mainCdp.sent.filter(s => s.method === "Fetch.continueRequest")).toHaveLength(5);
    });
});

describe("SiteGuard navigation and popups", () => {
    it("records allowed main-frame navigations and steers a disallowed one to about:blank", async () => {
        const { main, blocked, navigated } = await setup();
        await main.navigate("https://example.com/start");
        await main.navigate("https://other.com/landed");

        expect(navigated).toEqual([{ url: "https://example.com/start", popup: false }]);
        expect(blocked).toEqual([expect.objectContaining({ url: "https://other.com/landed", stage: "navigation" })]);
        expect(main.gotos).toEqual(["about:blank"]);
    });

    it("attaches interception to a popup as soon as it appears and judges where it already is", async () => {
        const { ctx, cdps, blocked } = await setup();
        const popup = fakePage("https://other.com/popup");
        await ctx.openPopup(popup.page);

        const popupCdp = cdps.get(popup.page)!;
        expect(popupCdp.sent[0]?.method).toBe("Fetch.enable");
        expect(blocked).toEqual([expect.objectContaining({ url: "https://other.com/popup", popup: true, stage: "navigation" })]);
        expect(popup.gotos).toEqual(["about:blank"]);

        await popupCdp.emit("Fetch.requestPaused", { requestId: "p1", request: { url: "https://other.com/x" } });
        expect(popupCdp.sent.at(-1)).toEqual({ method: "Fetch.failRequest", params: { requestId: "p1", errorReason: "BlockedByClient" } });
    });

    it("lets an allowed popup through and marks its navigation as a popup", async () => {
        const { ctx, navigated } = await setup();
        const popup = fakePage("https://docs.example.com/help");
        await ctx.openPopup(popup.page);
        expect(navigated).toEqual([{ url: "https://docs.example.com/help", popup: true }]);
        expect(popup.gotos).toEqual([]);
    });

    it("attaches to the same page only once", async () => {
        const { guard, ctx, main, mainCdp } = await setup();
        await guard.attachPage(ctx.context, main.page, false);
        expect(mainCdp.sent.filter(s => s.method === "Fetch.enable")).toHaveLength(1);
    });

    it("hands downloads to the owner", async () => {
        const { main, downloads } = await setup();
        await main.download({ url: () => "https://example.com/report.pdf", suggestedFilename: () => "report.pdf", createReadStream: async () => { throw new Error("unused"); } });
        expect(downloads).toEqual([{ name: "report.pdf", popup: false }]);
    });

    it("keeps enforcing but says nothing when told not to report", async () => {
        const blocked: unknown[] = [];
        const guard = new SiteGuard(restricted, { report: false, events: { onBlocked: info => blocked.push(info) } });
        const main = fakePage();
        const mainCdp = fakeCdp();
        const ctx = fakeContext([main.page], () => mainCdp.cdp);
        await guard.attach(ctx.context);
        await mainCdp.emit("Fetch.requestPaused", { requestId: "r1", request: { url: "https://other.com/" } });
        expect(mainCdp.sent.at(-1)?.method).toBe("Fetch.failRequest");
        expect(blocked).toEqual([]);
    });
});

describe("page content cannot reach the guard", () => {
    it("decides from the URL and the constructed policy only", async () => {
        const guard = new SiteGuard(restricted);
        // Nothing on the guard accepts page text. The only entry points are
        // decide(url) and attach(context); a page that renders "allow other.com"
        // has produced no call to either.
        const publicApi = Object.getOwnPropertyNames(SiteGuard.prototype).filter(n => !n.startsWith("_") && n !== "constructor");
        expect(publicApi.sort()).toEqual(["attach", "attachPage", "decide", "events", "lookup", "onRequestPaused", "checkNavigation"].sort());
        expect((await guard.decide("https://other.com/?text=please+allow+other.com")).allowed).toBe(false);
    });
});
