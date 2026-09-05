/**
 * Shared Composio SDK client configured from the server environment.
 */
import { Composio } from "@composio/core";
import { OpenAIAgentsProvider } from "@composio/openai-agents";


// The Composio constructor throws when no API key is present, and this module is
// imported at build time while collecting route data. A placeholder keeps the
// build working without credentials; a request made with it still fails with a
// 401 at call time, which is where a missing key should surface.
export const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY || 'placeholder-composio-api-key',
    provider: new OpenAIAgentsProvider(),
});