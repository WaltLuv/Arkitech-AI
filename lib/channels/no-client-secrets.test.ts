import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard, not a unit test.
 *
 * Everything a browser downloads comes from a client component, and Next will
 * happily bundle a server module that a client component imports. This walks
 * the client tree and fails if anything there can reach a channel credential.
 * It is cheap, and it catches the mistake at the moment it is made rather than
 * in a production bundle.
 */
const CLIENT_ROOTS = ["components", "app"];

/** Names that must never appear in code shipped to a browser. */
const FORBIDDEN = [
    "CHANNEL_SECRET_KEY",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "openSecret",
    "sealSecret",
    "telegramCredentials",
    "slackBotToken",
    "lib/channels/secrets",
];

function* sourceFiles(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            yield* sourceFiles(path);
            continue;
        }

        if (/\.(tsx?|jsx?)$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx")) {
            yield path;
        }
    }
}

describe("channel credentials never reach the browser", () => {
    it("no client component mentions a channel secret", () => {
        const offenders: string[] = [];

        for (const root of CLIENT_ROOTS) {
            for (const file of sourceFiles(root)) {
                const source = readFileSync(file, "utf8");

                // Only files that actually run in a browser.
                if (!/^\s*["']use client["']/m.test(source)) continue;

                for (const name of FORBIDDEN) {
                    if (source.includes(name)) {
                        offenders.push(`${file} mentions ${name}`);
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it("no channel credential is exposed through a NEXT_PUBLIC_ variable", () => {
        // NEXT_PUBLIC_ is inlined into the bundle by definition.
        const offenders: string[] = [];

        for (const root of [...CLIENT_ROOTS, "lib", "inngest"]) {
            for (const file of sourceFiles(root)) {
                const source = readFileSync(file, "utf8");

                for (const match of source.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
                    if (/SECRET|TOKEN|KEY/.test(match[0]) && match[0] !== "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") {
                        offenders.push(`${file} uses ${match[0]}`);
                    }
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});
