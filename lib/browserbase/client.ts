/**
 * Server-only typed wrapper over the Browserbase SDK.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Credentials come from the environment, never from a caller.
 * 2. Writable capabilities never leave the server. sessions.debug() returns
 *    debuggerUrl, debuggerFullscreenUrl and wsUrl, and every one of them grants
 *    full control of the browser. The SDK offers no read-only variant.
 *
 *    They do carry a TTL (SessionDebugParams.timeout, up to 6 hours, otherwise
 *    expiring with the session), but a TTL is not revocation: a URL already
 *    copied stays usable until it lapses, and cannot be withdrawn when control
 *    changes hands. So these are returned only to server code that has already
 *    checked a control lease, and are never placed in an event, an artifact, a
 *    log line, or a response body.
 */
import Browserbase from "@browserbasehq/sdk";
import { missingConfigMessage, readBrowserbaseConfig } from "./config";

export class BrowserbaseNotConfiguredError extends Error {
    readonly missing: string[];

    constructor(missing: string[]) {
        super(missingConfigMessage(missing));
        this.name = "BrowserbaseNotConfiguredError";
        this.missing = missing;
    }
}

export type SessionStatus = "PENDING" | "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED";

export type CreatedSession = {
    id: string;
    status: SessionStatus;
};

/** Built per call rather than at module scope, so importing this cannot throw. */
function client() {
    const result = readBrowserbaseConfig();
    if (!result.ok) throw new BrowserbaseNotConfiguredError(result.missing);

    return {
        bb: new Browserbase({ apiKey: result.config.apiKey }),
        projectId: result.config.projectId,
    };
}

/** True when browser work can run at all. Lets callers refuse early and clearly. */
export function isBrowserbaseConfigured(): boolean {
    return readBrowserbaseConfig().ok;
}

export async function createSession(options: {
    /** Recorded before this call so an ambiguous outcome can be reconciled. */
    creationKey: string;
    contextId?: string;
    keepAlive?: boolean;
}): Promise<CreatedSession> {
    const { bb, projectId } = client();

    const session = await bb.sessions.create({
        projectId,
        keepAlive: options.keepAlive ?? false,
        // Carried so a session created by a request whose response was lost can
        // still be found and adopted instead of creating a second paid browser.
        userMetadata: { arkitechCreationKey: options.creationKey },
        ...(options.contextId
            ? { browserSettings: { context: { id: options.contextId, persist: true } } }
            : {}),
    });

    return { id: session.id, status: session.status as SessionStatus };
}

/** Finds a session created by a call whose result never came back. */
export async function findSessionByCreationKey(creationKey: string) {
    const { bb, projectId } = client();

    // SessionListParams takes only q and status in 2.19.0; there is no
    // projectId filter, so the key itself must be unique enough to identify it.
    void projectId;
    const sessions = await bb.sessions.list({
        q: `user_metadata['arkitechCreationKey']:'${creationKey}'`,
    });

    return sessions?.[0] ?? null;
}

export async function retrieveSession(sessionId: string) {
    const { bb } = client();
    return bb.sessions.retrieve(sessionId);
}

/** Explicit release. Arkitech never relies on a provider timeout to stop paying. */
export async function releaseSession(sessionId: string) {
    const { bb, projectId } = client();
    return bb.sessions.update(sessionId, { projectId, status: "REQUEST_RELEASE" });
}

export async function createContext() {
    const { bb, projectId } = client();
    return bb.contexts.create({ projectId });
}

/**
 * Live view URLs. Every one of these is writable.
 *
 * Callers must treat the result as a secret: it is never returned to a browser,
 * logged, or written to an event or artifact row. It exists so server code can
 * mediate a view after checking who holds control.
 */
export async function getWritableLiveUrls(sessionId: string, ttlSeconds?: number) {
    const { bb } = client();
    return bb.sessions.debug(sessionId, ttlSeconds ? { timeout: ttlSeconds } : undefined);
}
