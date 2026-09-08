import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

import { verifySlackRequest } from "@/lib/channels/slack/verify";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = '{"type":"event_callback","team_id":"T1"}';

/** The signature Slack would send for this body at this time. */
function sign(body: string, timestamp: number, secret = SECRET) {
    return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

const now = 1_700_000_000_000;
const nowSeconds = Math.floor(now / 1000);

describe("verifySlackRequest", () => {
    it("accepts a correctly signed request", () => {
        const result = verifySlackRequest({
            signingSecret: SECRET,
            body: BODY,
            signature: sign(BODY, nowSeconds),
            timestamp: String(nowSeconds),
            nowMs: now,
        });

        expect(result).toEqual({ valid: true });
    });

    it("refuses a missing signature", () => {
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: null,
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "missing_headers" });
    });

    it("refuses a missing timestamp", () => {
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, nowSeconds),
                timestamp: null,
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "missing_headers" });
    });

    it("refuses a signature made with a different secret", () => {
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, nowSeconds, "someone-elses-secret"),
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "mismatch" });
    });

    it("refuses a valid signature over a different body", () => {
        // The whole point: a signed envelope must not authenticate other content.
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: '{"type":"event_callback","team_id":"T-EVIL"}',
                signature: sign(BODY, nowSeconds),
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "mismatch" });
    });

    it("refuses a replayed request older than five minutes", () => {
        const old = nowSeconds - 301;

        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, old),
                timestamp: String(old),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "stale" });
    });

    it("accepts one just inside the window", () => {
        const edge = nowSeconds - 299;

        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, edge),
                timestamp: String(edge),
                nowMs: now,
            }),
        ).toEqual({ valid: true });
    });

    it("refuses a timestamp far in the future", () => {
        const future = nowSeconds + 3600;

        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, future),
                timestamp: String(future),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "stale" });
    });

    it("refuses an unknown signature version", () => {
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: sign(BODY, nowSeconds).replace("v0=", "v9="),
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "bad_version" });
    });

    it("refuses everything when no signing secret is configured", () => {
        // An install without the secret must fail closed, not open.
        expect(
            verifySlackRequest({
                signingSecret: undefined,
                body: BODY,
                signature: sign(BODY, nowSeconds),
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "not_configured" });
    });

    it("refuses a truncated signature without throwing", () => {
        expect(
            verifySlackRequest({
                signingSecret: SECRET,
                body: BODY,
                signature: "v0=abc",
                timestamp: String(nowSeconds),
                nowMs: now,
            }),
        ).toEqual({ valid: false, reason: "mismatch" });
    });
});
