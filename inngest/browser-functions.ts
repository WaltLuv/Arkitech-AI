/**
 * Inngest functions for browser work.
 *
 * `drainBrowserQueue` claims the next runnable run and executes it. It is
 * triggered when a run is queued and by a cron every minute, so a run left
 * waiting for capacity is picked up once a slot frees, and a worker that
 * died never leaves the queue stalled.
 *
 * The claim is one conditional statement in `queue.ts`; a retried step finds
 * the run already claimed and does nothing, which is the whole recovery story.
 */
import { inngest } from "./client";
import { claimNextRunnableBrowserRun } from "@/lib/browserbase/queue";
import { executeBrowserRun, finishBrowserRun } from "@/lib/browserbase/worker";
import { recordEventWithRetry } from "@/lib/browserbase/activity";

export const BROWSER_RUN_QUEUED = "browser/run.queued";

export const drainBrowserQueue = inngest.createFunction(
    {
        id: "drain-browser-queue",
        triggers: [{ event: BROWSER_RUN_QUEUED }, { cron: "* * * * *" }],
        // One drain at a time. Capacity is enforced by the slot table anyway;
        // this only avoids several drains fighting over nothing.
        concurrency: { limit: 1 },
    },
    async ({ step, runId }) => {
        const workerId = `inngest:${runId}`;

        const claimed = await step.run("claim-next-browser-run", async () => {
            const claimedRun = await claimNextRunnableBrowserRun(workerId);
            if (!claimedRun) return null;

            await recordEventWithRetry({
                browserRunId: claimedRun.id,
                userEmail: claimedRun.userEmail,
                kind: "claimed",
                actor: "system",
                actorId: workerId,
                detail: { slotIndex: claimedRun.slotIndex, attempt: claimedRun.attempt },
            });

            return claimedRun;
        });

        if (!claimed) return { status: "idle" };

        const outcome = await step.run(`execute-browser-run-${claimed.id}`, async () => {
            try {
                return await executeBrowserRun(claimed, workerId);
            } catch (error) {
                // executeBrowserRun reports outcomes rather than throwing; this
                // catches anything before it got that far.
                return { status: "failed" as const, reason: error instanceof Error ? error.message : String(error) };
            }
        });

        await step.run(`finish-browser-run-${claimed.id}`, async () => {
            await finishBrowserRun(claimed, outcome);
        });

        // Something else may be waiting behind the slot this run just freed.
        await step.sendEvent("drain-again", { name: BROWSER_RUN_QUEUED, data: { after: claimed.id } });

        return { status: outcome.status, browserRunId: claimed.id };
    },
);
