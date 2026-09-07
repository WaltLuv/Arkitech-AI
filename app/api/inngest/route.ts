/**
 * Inngest route handler that exposes scheduled background functions to Next.js.
 */
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
    ExecuteScheduledAgent,
    ProcessScheduledAgent,
} from "@/inngest/functions";
import { drainBrowserQueue } from "@/inngest/browser-functions";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [ProcessScheduledAgent, ExecuteScheduledAgent, drainBrowserQueue],
});
