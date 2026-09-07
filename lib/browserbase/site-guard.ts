/**
 * Enforcing the site policy inside a live browser session.
 *
 * Every network request the session makes is paused through the DevTools
 * Fetch domain and judged before it leaves. A redirect is a new request at
 * this level, so a redirect to a disallowed host is refused at the hop, not
 * followed. Popups and new tabs are attached as they appear and judged the
 * same way. Main-frame navigations are checked a second time from the frame
 * side and steered to about:blank if anything slipped through.
 *
 * The guard is built from the policy loaded for the run's owner. The page has
 * no way to reach it: the only thing the page contributes is the URL it asks
 * for, and that is the thing being judged.
 */
import { evaluateUrl, isIpLiteral, type DenyReason, type SiteDecision, type SitePolicy } from "./site-policy";

/** The slice of a CDP session the guard needs. Playwright's satisfies it. */
export interface GuardCdp {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
    on(event: string, handler: (payload: never) => void): unknown;
}

export interface GuardFrame {
    url(): string;
}

export interface GuardDownload {
    url(): string;
    suggestedFilename(): string;
    createReadStream(): Promise<NodeJS.ReadableStream>;
}

/** The slice of a Playwright page the guard needs. */
export interface GuardPage {
    url(): string;
    isClosed(): boolean;
    mainFrame(): GuardFrame;
    on(event: "framenavigated", handler: (frame: GuardFrame) => void): unknown;
    on(event: "download", handler: (download: GuardDownload) => void): unknown;
    goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
}

export interface GuardContext {
    pages(): GuardPage[];
    on(event: "page", handler: (page: GuardPage) => void): unknown;
    newCDPSession(page: GuardPage): Promise<GuardCdp>;
}

export type BlockedInfo = {
    url: string;
    host: string;
    reason: DenyReason;
    /** Where it was caught: a paused request, or a frame that had navigated. */
    stage: "request" | "navigation";
    /** The request was the target of a redirect from somewhere allowed. */
    redirected: boolean;
    /** It happened in a popup or a tab the run opened, not the first tab. */
    popup: boolean;
};

export type NavigatedInfo = { url: string; popup: boolean };

export type GuardEvents = {
    onBlocked?: (info: BlockedInfo) => void;
    onNavigated?: (info: NavigatedInfo) => void;
    onDownload?: (download: GuardDownload, popup: boolean) => void;
};

export type HostResolver = (host: string) => Promise<string[]>;

export type SiteGuardOptions = {
    /** Looks a host up so a public name pointing at a private address is refused. */
    resolve?: HostResolver;
    /**
     * Whether this guard reports what it sees. The worker's guard reports;
     * an operator route's guard on the same session enforces silently, so
     * one blocked request is not recorded twice.
     */
    report?: boolean;
    events?: GuardEvents;
};

type PausedRequest = {
    requestId: string;
    request: { url: string };
    redirectedRequestId?: string;
};

export class SiteGuard {
    private readonly lookups = new Map<string, Promise<string[]>>();
    private readonly attached = new WeakSet<object>();
    private lastNavigated: string | null = null;

    constructor(readonly policy: SitePolicy, private readonly options: SiteGuardOptions = {}) {}

    private get events(): GuardEvents {
        return this.options.report === false ? {} : (this.options.events ?? {});
    }

    private async lookup(host: string): Promise<string[]> {
        const resolve = this.options.resolve;
        if (!resolve) return [];

        let pending = this.lookups.get(host);
        if (!pending) {
            // A failed lookup yields no addresses; the name rules still apply
            // and the browser will fail to resolve it too.
            pending = resolve(host).catch(() => []);
            this.lookups.set(host, pending);
        }
        return pending;
    }

    /** The decision for one URL, with resolution where it can matter. */
    async decide(url: string): Promise<SiteDecision> {
        const byName = evaluateUrl(url, this.policy);
        if (!byName.allowed || !byName.host || isIpLiteral(byName.host)) return byName;

        const addresses = await this.lookup(byName.host);
        return addresses.length === 0 ? byName : evaluateUrl(url, this.policy, addresses);
    }

    /** Attaches to every page the context has, and every page it will open. */
    async attach(context: GuardContext): Promise<void> {
        for (const page of context.pages()) await this.attachPage(context, page, false);
        context.on("page", page => { void this.attachPage(context, page, true); });
    }

    async attachPage(context: GuardContext, page: GuardPage, popup: boolean): Promise<void> {
        if (this.attached.has(page)) return;
        this.attached.add(page);

        page.on("framenavigated", frame => {
            if (frame !== page.mainFrame()) return;
            void this.checkNavigation(page, frame.url(), popup);
        });
        page.on("download", download => {
            this.events.onDownload?.(download, popup);
        });

        try {
            const cdp = await context.newCDPSession(page);
            cdp.on("Fetch.requestPaused", (payload: never) => { void this.onRequestPaused(cdp, payload as PausedRequest, popup); });
            await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
        } catch {
            // The page closed before interception could start, or the session
            // is gone. A closed page makes no requests; a gone session is
            // handled by whoever owns the connection.
        }

        // A popup may already be somewhere by the time this runs.
        await this.checkNavigation(page, page.url(), popup);
    }

    private async onRequestPaused(cdp: GuardCdp, paused: PausedRequest, popup: boolean): Promise<void> {
        let decision: SiteDecision;
        try {
            decision = await this.decide(paused.request.url);
        } catch {
            decision = { allowed: false, reason: "invalid_url", host: "" };
        }

        try {
            if (decision.allowed) {
                await cdp.send("Fetch.continueRequest", { requestId: paused.requestId });
                return;
            }
            await cdp.send("Fetch.failRequest", { requestId: paused.requestId, errorReason: "BlockedByClient" });
        } catch {
            // The request or the session is already gone.
        }

        if (!decision.allowed) {
            this.events.onBlocked?.({
                url: paused.request.url,
                host: decision.host,
                reason: decision.reason,
                stage: "request",
                redirected: Boolean(paused.redirectedRequestId),
                popup,
            });
        }
    }

    private async checkNavigation(page: GuardPage, url: string, popup: boolean): Promise<void> {
        if (!url || page.isClosed()) return;

        const decision = await this.decide(url);
        if (decision.allowed) {
            if (decision.host && url !== this.lastNavigated) {
                this.lastNavigated = url;
                this.events.onNavigated?.({ url, popup });
            }
            return;
        }

        this.events.onBlocked?.({
            url,
            host: decision.host,
            reason: decision.reason,
            stage: "navigation",
            redirected: false,
            popup,
        });

        // Leave the page rather than let it render: the request layer should
        // have refused it, and this is the second line.
        await page.goto("about:blank", { waitUntil: "commit" }).catch(() => undefined);
    }
}
