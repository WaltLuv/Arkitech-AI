/**
 * Encryption for the credentials a channel connection holds.
 *
 * A bot token is a bearer credential: whoever has it can read a customer's
 * messages and speak as their Team member. Postgres rows get copied into
 * backups, staging restores and support queries, so the token is sealed before
 * it is stored and opened only in the request that needs to call the provider.
 *
 * AES-256-GCM, so a tampered envelope fails to open rather than decrypting to
 * something attacker-chosen. The envelope is self-describing and versioned, so
 * a future key rotation can recognise what it is looking at.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Envelope format: v1.<iv>.<authTag>.<ciphertext>, each part base64url. */
const VERSION = "v1";

const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Reads the key at call time rather than at import.
 *
 * This module is imported by route files that Next collects at build time,
 * where no secret is present. Throwing then would fail the build over a
 * credential that is only needed to serve a request.
 */
function key(): Buffer {
    const configured = process.env.CHANNEL_SECRET_KEY;

    if (!configured) {
        throw new Error("CHANNEL_SECRET_KEY is not set");
    }

    // Accept base64 or hex, because a generated key gets pasted by a human and
    // both are what the usual one-liners produce.
    const decoded = /^[0-9a-fA-F]{64}$/.test(configured)
        ? Buffer.from(configured, "hex")
        : Buffer.from(configured, "base64");

    if (decoded.length !== KEY_BYTES) {
        throw new Error("CHANNEL_SECRET_KEY must decode to 32 bytes");
    }

    return decoded;
}

/** True when connections can actually be created. Used by health reporting. */
export function isChannelSecretConfigured(): boolean {
    try {
        key();
        return true;
    } catch {
        return false;
    }
}

/**
 * Seal a credential bundle.
 *
 * Takes an object rather than a string so a provider can keep several secrets
 * together (Slack needs a bot token and a signing secret) without inventing a
 * column per provider on the shared connection table.
 */
export function sealSecret(value: Record<string, string>): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);

    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), "utf8"),
        cipher.final(),
    ]);

    return [
        VERSION,
        iv.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
        ciphertext.toString("base64url"),
    ].join(".");
}

/**
 * Open a sealed credential bundle.
 *
 * Throws on any tampering or on a key that does not match. Callers treat a
 * throw as "this connection is unusable" and mark it needs_attention rather
 * than reporting a decryption error to the user, which would say more about
 * the install than a user needs to know.
 */
export function openSecret(envelope: string): Record<string, string> {
    const parts = envelope.split(".");

    if (parts.length !== 4 || parts[0] !== VERSION) {
        throw new Error("Unrecognised secret envelope");
    }

    const [, iv, authTag, ciphertext] = parts;

    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
    ]).toString("utf8");

    return JSON.parse(plaintext) as Record<string, string>;
}
