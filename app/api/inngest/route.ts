/**
 * Inngest route handler that exposes scheduled background functions to Next.js.
 */
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
    ExecuteScheduledAgent,
    ProcessScheduledAgent,
} from "@/inngest/functions";
import { drainBrowserQueue, sweepBrowserResourcesFunction } from "@/inngest/browser-functions";
import { RespondToChannelMessage, SweepChannelInboundEvents } from "@/inngest/channel-functions";

export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: [
        ProcessScheduledAgent,
        ExecuteScheduledAgent,
        drainBrowserQueue,
        sweepBrowserResourcesFunction,
        RespondToChannelMessage,
        SweepChannelInboundEvents,
    ],
});
