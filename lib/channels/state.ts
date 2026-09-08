/**
 * Signed state for the Slack install redirect.
 *
 * OAuth sends the user to Slack and back, and the request that returns carries
 * no Arkitech session context of its own beyond a cookie. The state parameter
 * has to say which account and which Team member started the install, and it
 * has to be impossible for someone to forge one that names a different account.
 *
 * So it is signed with the same key that seals connection credentials, and it
 * expires: an install link is used within minutes or not at all.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

function signingKey(): string {
    const key = process.env.CHANNEL_SECRET_KEY;

    if (!key) {
        throw new Error("CHANNEL_SECRET_KEY is not set");
    }

    return key;
}

export type InstallState = {
    userEmail: string;
    agentId: string;
    issuedAt: number;
};

export function signState(state: Omit<InstallState, "issuedAt">): string {
    const payload = Buffer.from(
        JSON.stringify({ ...state, issuedAt: Date.now() } satisfies InstallState),
    ).toString("base64url");

    const signature = createHmac("sha256", signingKey()).update(payload).digest("base64url");

    return `${payload}.${signature}`;
}

export function verifyState(value: string | null): InstallState | null {
    if (!value) {
        return null;
    }

    const [payload, signature] = value.split(".");

    if (!payload || !signature) {
        return null;
    }

    const expected = createHmac("sha256", signingKey()).update(payload).digest("base64url");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return null;
    }

    try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as InstallState;

        if (!parsed.userEmail || !parsed.agentId) {
            return null;
        }

        // An old state is a link someone kept. Refuse it rather than complete
        // an install the person may no longer intend.
        if (Date.now() - parsed.issuedAt > TTL_MS) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}
