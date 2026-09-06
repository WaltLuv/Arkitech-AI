/**
 * Browserbase configuration. Server-only.
 *
 * Read from the environment and never from a caller, so no request can point
 * Arkitech at a different project or key. Nothing here is exported to the
 * client bundle: none of these names is prefixed NEXT_PUBLIC_.
 */

export type BrowserbaseConfig = {
    apiKey: string;
    projectId: string;
};

export type ConfigResult =
    | { ok: true; config: BrowserbaseConfig }
    | { ok: false; missing: string[] };

/**
 * Verified against @browserbasehq/sdk 2.19.0: sessions.create takes projectId,
 * and the client takes apiKey. BROWSERBASE_AGENT_ID is deliberately not read
 * here; it belongs to the existing hosted-agent research tool in
 * lib/browserbase-tool.ts and is not used by session-based execution.
 */
export function readBrowserbaseConfig(
    env: NodeJS.ProcessEnv = process.env,
): ConfigResult {
    const apiKey = env.BROWSERBASE_API_KEY?.trim();
    const projectId = env.BROWSERBASE_PROJECT_ID?.trim();

    const missing: string[] = [];
    if (!apiKey) missing.push("BROWSERBASE_API_KEY");
    if (!projectId) missing.push("BROWSERBASE_PROJECT_ID");

    if (missing.length > 0) return { ok: false, missing };

    return { ok: true, config: { apiKey: apiKey as string, projectId: projectId as string } };
}

/** The message shown when browser work is requested without configuration. */
export function missingConfigMessage(missing: string[]): string {
    return `Browser execution is not configured. Missing: ${missing.join(", ")}.`;
}
