/**
 * Server-only typed wrapper over the Browserbase SDK.
 *
 * Two rules this file exists to enforce:
 *
 * 1. Credentials come from the environment, never from a caller.
 * 2. Writable capabilities are never obtained at all. sessions.debug() returns
 *    debuggerUrl, debuggerFullscreenUrl and wsUrl, and every one of them grants
 *    full control of the browser. The SDK offers no read-only variant.
 *
 *    They do carry a TTL (SessionDebugParams.timeout, up to 6 hours, otherwise
 *    expiring with the session), but a TTL is not revocation: a URL already
 *    copied stays usable until it lapses, and cannot be withdrawn when control
 *    changes hands. Rather than hold something that cannot be taken back, this
 *    module simply never asks for one. The only capability it touches is the
 *    session's connect URL, read inside driver.ts for the duration of one CDP
 *    connection and never stored, logged, or returned.
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

/*
 * Deliberately absent: a wrapper around sessions.debug().
 *
 * It returns debuggerUrl, debuggerFullscreenUrl and wsUrl, every one of which
 * grants full control of the browser and none of which can be revoked once
 * handed out. Watching is served instead by server-captured frames, and human
 * input by the mediated input route, so nothing in Arkitech needs those URLs
 * and no function here can be called by mistake to obtain one.
 *
 * Persistent Contexts are absent for the same reason they are unused: nothing
 * creates or reuses one, so no cookie jar or browser profile is shared between
 * runs or between users. Adding them is a deliberate feature with an ownership
 * design of its own, not a wrapper waiting to be called.
 */
