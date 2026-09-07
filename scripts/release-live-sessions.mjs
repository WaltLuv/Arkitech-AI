/**
 * Safety net for the live verification workflow.
 *
 * The live test releases its own session in teardown. Teardown does not run if
 * the job is cancelled or hits its timeout, and an unreleased session keeps
 * costing money, so this runs afterwards regardless of how the job ended.
 *
 * It releases only sessions this workflow created, identified by the creation
 * key the live test sets. Anything else in the project is left alone.
 *
 * Prints session ids and statuses. Never prints a key, a connect URL, or any
 * other capability.
 */
import Browserbase from "@browserbasehq/sdk";

const CREATION_KEY_PREFIX = "arkitech-live-";

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

if (!apiKey || !projectId) {
    console.log("[cleanup] no credentials in the environment; nothing to release.");
    process.exit(0);
}

/** Redacts anything that would let a reader of this log drive a browser. */
function safe(text) {
    return String(text)
        .replace(/wss?:\/\/[^\s"'<>]+/gi, "[redacted-ws-url]")
        .replace(/apiKey=[^&\s"'<>]+/gi, "apiKey=[redacted]")
        .replace(/\bbb_(live|test)_[A-Za-z0-9]+/g, "[redacted-key]");
}

const bb = new Browserbase({ apiKey });

try {
    const sessions = await bb.sessions.list({ status: "RUNNING" });
    const mine = (sessions ?? []).filter(session => {
        const key = session?.userMetadata?.arkitechCreationKey;
        return typeof key === "string" && key.startsWith(CREATION_KEY_PREFIX);
    });

    if (mine.length === 0) {
        console.log("[cleanup] no live-verification sessions left running.");
        process.exit(0);
    }

    console.log(`[cleanup] releasing ${mine.length} live-verification session(s).`);

    for (const session of mine) {
        try {
            await bb.sessions.update(session.id, { projectId, status: "REQUEST_RELEASE" });
            console.log(`[cleanup] released ${session.id}`);
        } catch (error) {
            // Reported, never thrown: a failed release must not turn a passing
            // verification into a failure, and the next sweep will catch it.
            console.log(`[cleanup] could not release ${session.id}: ${safe(error?.message ?? error)}`);
        }
    }
} catch (error) {
    console.log(`[cleanup] could not list sessions: ${safe(error?.message ?? error)}`);
}
