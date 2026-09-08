/**
 * Slack request verification.
 *
 * Slack signs every request with an app-level signing secret. The algorithm
 * below matches Slack's own SDK (slackapi/bolt-js, src/receivers/verify-request.ts):
 * HMAC-SHA256 over the literal string `v0:<timestamp>:<raw body>`, hex encoded,
 * compared against the `v0=` prefixed X-Slack-Signature header, with requests
 * older than five minutes rejected as stale.
 *
 * Two details are easy to get wrong and both are load-bearing. The body must be
 * the raw bytes as received, because re-serialising parsed JSON changes the
 * signature. And the comparison must be constant-time, because a byte-by-byte
 * compare leaks the expected signature to anyone willing to measure.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack's own tolerance, and the one its SDK enforces. */
export const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

export type SlackVerification =
    | { valid: true }
    | { valid: false; reason: "not_configured" | "missing_headers" | "stale" | "bad_version" | "mismatch" };

export function verifySlackRequest({
    signingSecret,
    body,
    signature,
    timestamp,
    nowMs = Date.now(),
}: {
    signingSecret: string | undefined;
    body: string;
    signature: string | null;
    timestamp: string | null;
    nowMs?: number;
}): SlackVerification {
    if (!signingSecret) {
        return { valid: false, reason: "not_configured" };
    }

    if (!signature || !timestamp) {
        return { valid: false, reason: "missing_headers" };
    }

    const timestampSeconds = Number(timestamp);

    if (!Number.isFinite(timestampSeconds)) {
        return { valid: false, reason: "missing_headers" };
    }

    // Rejects a captured request being replayed later. Also rejects a request
    // from the future, which a valid Slack delivery never is.
    const ageSeconds = Math.floor(nowMs / 1000) - timestampSeconds;

    if (Math.abs(ageSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
        return { valid: false, reason: "stale" };
    }

    const [version, provided] = signature.split("=");

    if (version !== "v0" || !provided) {
        return { valid: false, reason: "bad_version" };
    }

    const expected = createHmac("sha256", signingSecret)
        .update(`v0:${timestampSeconds}:${body}`)
        .digest("hex");

    const providedBuffer = Buffer.from(provided, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
    if (providedBuffer.length !== expectedBuffer.length) {
        return { valid: false, reason: "mismatch" };
    }

    return timingSafeEqual(providedBuffer, expectedBuffer)
        ? { valid: true }
        : { valid: false, reason: "mismatch" };
}
