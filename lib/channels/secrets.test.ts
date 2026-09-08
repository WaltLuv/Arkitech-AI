import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isChannelSecretConfigured, openSecret, sealSecret } from "@/lib/channels/secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");
const original = process.env.CHANNEL_SECRET_KEY;

beforeEach(() => {
    process.env.CHANNEL_SECRET_KEY = KEY;
});

afterEach(() => {
    process.env.CHANNEL_SECRET_KEY = original;
});

describe("channel credential sealing", () => {
    it("opens what it sealed", () => {
        const sealed = sealSecret({ botToken: "123:abc", webhookSecret: "s3cret" });

        expect(openSecret(sealed)).toEqual({ botToken: "123:abc", webhookSecret: "s3cret" });
    });

    it("does not put the credential in the envelope", () => {
        const sealed = sealSecret({ botToken: "123:supersecrettoken" });

        expect(sealed).not.toContain("supersecrettoken");
        expect(Buffer.from(sealed, "utf8").toString("base64")).not.toContain("supersecrettoken");
    });

    it("produces a different envelope every time", () => {
        // A fixed IV would make two identical tokens visibly identical at rest.
        const a = sealSecret({ botToken: "same" });
        const b = sealSecret({ botToken: "same" });

        expect(a).not.toEqual(b);
    });

    it("refuses a tampered envelope rather than decrypting it", () => {
        const sealed = sealSecret({ botToken: "123:abc" });
        const [version, iv, tag, ciphertext] = sealed.split(".");

        // Flip a byte of the ciphertext. GCM's tag is what catches this.
        const bytes = Buffer.from(ciphertext, "base64url");
        bytes[0] ^= 0xff;

        expect(() => openSecret([version, iv, tag, bytes.toString("base64url")].join("."))).toThrow();
    });

    it("refuses an envelope sealed with a different key", () => {
        const sealed = sealSecret({ botToken: "123:abc" });

        process.env.CHANNEL_SECRET_KEY = Buffer.alloc(32, 9).toString("base64");

        expect(() => openSecret(sealed)).toThrow();
    });

    it("refuses an unrecognised envelope shape", () => {
        expect(() => openSecret("not-an-envelope")).toThrow(/Unrecognised/);
    });

    it("accepts a hex key as well as base64", () => {
        process.env.CHANNEL_SECRET_KEY = Buffer.alloc(32, 3).toString("hex");

        expect(openSecret(sealSecret({ a: "b" }))).toEqual({ a: "b" });
    });

    it("refuses a key that is not 32 bytes", () => {
        process.env.CHANNEL_SECRET_KEY = Buffer.alloc(16, 1).toString("base64");

        expect(() => sealSecret({ a: "b" })).toThrow(/32 bytes/);
        expect(isChannelSecretConfigured()).toBe(false);
    });

    it("reports whether it is configured without throwing", () => {
        expect(isChannelSecretConfigured()).toBe(true);

        delete process.env.CHANNEL_SECRET_KEY;

        expect(isChannelSecretConfigured()).toBe(false);
    });
});
