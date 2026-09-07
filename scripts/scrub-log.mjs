/**
 * Scrubs a log file before it is kept as a CI artifact.
 *
 * The live test is written not to print secrets, and provider errors are
 * redacted before they propagate. This is the second line: an unexpected
 * stack trace from somewhere else in the stack should not be the thing that
 * publishes a key.
 *
 * It removes the literal values of the secrets in this process's environment,
 * which catches anything a pattern would miss, and then the shapes that carry
 * browser control or identity.
 *
 *     node scripts/scrub-log.mjs <file>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const [file] = process.argv.slice(2);
if (!file) {
    console.error("usage: node scripts/scrub-log.mjs <file>");
    process.exit(2);
}

// A job that died before producing a log must not fail again in cleanup.
if (!existsSync(file)) {
    console.log(`[scrub] ${file} does not exist; nothing to scrub.`);
    process.exit(0);
}

/** Env vars whose literal values must never appear in a kept log. */
const SECRET_ENV = [
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "OPENAI_API_KEY",
    "BROWSERBASE_AGENT_ID",
    "DATABASE_URL",
    "CLERK_SECRET_KEY",
];

const PATTERNS = [
    [/wss?:\/\/[^\s"'<>]+/gi, "[redacted-ws-url]"],
    [/https?:\/\/[^\s"'<>]*devtools\/(browser|page)\/[^\s"'<>]*/gi, "[redacted-devtools-url]"],
    [/apiKey=[^&\s"'<>]+/gi, "apiKey=[redacted]"],
    [/signingKey=[^&\s"'<>]+/gi, "signingKey=[redacted]"],
    [/\bbb_(live|test)_[A-Za-z0-9]+/g, "[redacted-key]"],
    [/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
    [/(X-Amz-Signature|signature|token)=[^&\s"'<>]+/gi, "$1=[redacted]"],
];

let text = readFileSync(file, "utf8");
let removed = 0;

for (const name of SECRET_ENV) {
    const value = process.env[name];
    // Short values would match too much; a real secret is never this short.
    if (!value || value.length < 8) continue;

    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = text;
    text = text.replace(new RegExp(escaped, "g"), `[redacted-${name}]`);
    if (text !== before) removed += 1;
}

for (const [pattern, replacement] of PATTERNS) {
    text = text.replace(pattern, replacement);
}

writeFileSync(file, text);
console.log(`[scrub] ${file}: ${removed} literal secret value(s) removed, patterns applied.`);
