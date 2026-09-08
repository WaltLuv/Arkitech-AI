/**
 * Slack Web API client.
 *
 * Slack answers 200 with `ok: false` for application errors, so the HTTP status
 * is not the thing to check. Errors carry a short machine code in `error`;
 * those codes are safe to keep, unlike a token, and they are what tells a
 * connection it has been revoked at the other end.
 */

const API_ROOT = "https://slack.com/api";

/** Slack truncates a message well before this, and refuses very large ones. */
export const MAX_MESSAGE_LENGTH = 3000;

export class SlackApiError extends Error {
    readonly code: string;

    constructor(method: string, code: string) {
        super(`Slack ${method} failed: ${code}`);
        this.name = "SlackApiError";
        this.code = code;
    }
}

async function call<T>(
    method: string,
    token: string,
    params: Record<string, unknown>,
): Promise<T> {
    const response = await fetch(`${API_ROOT}/${method}`, {
        method: "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as
        | ({ ok: boolean; error?: string } & Record<string, unknown>)
        | null;

    if (!payload?.ok) {
        throw new SlackApiError(method, payload?.error ?? `http_${response.status}`);
    }

    return payload as T;
}

export type SlackIdentity = {
    team_id: string;
    team: string;
    user_id: string;
    bot_id?: string;
};

/** Confirms a stored token still works and says which workspace it belongs to. */
export function authTest(token: string): Promise<SlackIdentity> {
    return call<SlackIdentity>("auth.test", token, {});
}

export type SlackInstall = {
    access_token: string;
    bot_user_id: string;
    team: { id: string; name: string };
    authed_user?: { id: string };
};

/**
 * Exchange an OAuth code for a workspace's bot token.
 *
 * This endpoint authenticates with the app's client credentials rather than a
 * bearer token, so it does not go through `call`.
 */
export async function exchangeOAuthCode({
    code,
    clientId,
    clientSecret,
    redirectUri,
}: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}): Promise<SlackInstall> {
    const response = await fetch(`${API_ROOT}/oauth.v2.access`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15_000),
    });

    const payload = (await response.json().catch(() => null)) as
        | (SlackInstall & { ok: boolean; error?: string })
        | null;

    if (!payload?.ok) {
        throw new SlackApiError("oauth.v2.access", payload?.error ?? `http_${response.status}`);
    }

    return payload;
}

export type PostedMessage = { ts: string };

export function postMessage({
    token,
    channel,
    text,
    threadTs,
}: {
    token: string;
    channel: string;
    text: string;
    threadTs?: string | null;
}): Promise<PostedMessage> {
    return call<PostedMessage>("chat.postMessage", token, {
        channel,
        text,
        ...(threadTs ? { thread_ts: threadTs } : {}),
    });
}

/**
 * Ends Arkitech's use of a workspace token.
 *
 * Slack has no "delete the subscription" call the way Telegram does: event
 * delivery is a property of the app, not of one install. Revoking the token is
 * what actually stops Arkitech acting for that workspace.
 */
export function revokeToken(token: string): Promise<{ revoked: boolean }> {
    return call<{ revoked: boolean }>("auth.revoke", token, {});
}

/** Splits text at paragraph breaks so a long answer arrives readable. */
export function splitForSlack(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
    if (text.length <= limit) {
        return [text];
    }

    const chunks: string[] = [];
    let rest = text;

    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
        const cut = breakAt > limit * 0.5 ? breakAt : limit;

        chunks.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }

    if (rest) {
        chunks.push(rest);
    }

    return chunks;
}
