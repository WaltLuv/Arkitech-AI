/**
 * The durable browser queue.
 *
 * Two invariants, both enforced by the database rather than by reading and then
 * deciding:
 *
 * 1. **Capacity.** Concurrency is limited by the number of rows in browserSlot,
 *    so no interleaving can produce an extra active session. Counting active
 *    runs and comparing to a limit would not hold: the Agent Slot work measured
 *    that pattern failing, and measured that neither an advisory lock nor
 *    SELECT FOR UPDATE repairs it, because the count reads the snapshot taken
 *    before the lock is acquired.
 *
 * 2. **Claiming.** A queued run is claimed by a single conditional UPDATE that
 *    selects its target FOR UPDATE SKIP LOCKED. Two workers racing therefore
 *    take different rows, or one takes none.
 *
 * Capacity is acquired before a run is claimed, so a run is never left claimed
 * with nowhere to execute.
 */
import { db } from "@/db";
import { sql } from "drizzle-orm";

export type QueuePriority = "urgent" | "normal";

export type ClaimedBrowserRun = {
    id: string;
    userEmail: string;
    agentId: string;
    task: string;
    priority: QueuePriority;
    attempt: number;
    slotIndex: number;
};

/**
 * Takes a free execution slot for a run, or returns null when all are busy.
 * SKIP LOCKED means two callers never contend for the same row.
 */
export async function acquireBrowserSlot(browserRunId: string): Promise<number | null> {
    const result = await db.execute(sql`
        UPDATE "browserSlot"
        SET "browser_run_id" = ${browserRunId}::uuid, "claimed_at" = now()
        WHERE "slot_index" = (
            SELECT "slot_index" FROM "browserSlot"
            WHERE "browser_run_id" IS NULL
            ORDER BY "slot_index"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING "slot_index"
    `);

    const row = result.rows?.[0] as { slot_index?: number } | undefined;
    return row?.slot_index ?? null;
}

/** Frees whatever slot a run holds. Safe to call when it holds none. */
export async function releaseBrowserSlot(browserRunId: string): Promise<void> {
    await db.execute(sql`
        UPDATE "browserSlot"
        SET "browser_run_id" = NULL, "claimed_at" = NULL
        WHERE "browser_run_id" = ${browserRunId}::uuid
    `);
}

/**
 * Claims the next eligible run: urgent before normal, then oldest first, with
 * the id as a deterministic tie-break so ordering is never ambiguous.
 *
 * A run with cancellation requested is never claimed, which is what makes
 * cancelling a queued run actually prevent execution.
 */
export async function claimNextQueuedRun(
    workerId: string,
): Promise<Omit<ClaimedBrowserRun, "slotIndex"> | null> {
    const result = await db.execute(sql`
        UPDATE "browserRun"
        SET "status" = 'claimed',
            "claimed_by" = ${workerId},
            "claimed_at" = now(),
            "attempt" = "attempt" + 1
        WHERE "id" = (
            SELECT "id" FROM "browserRun"
            WHERE "status" = 'queued'
              AND "cancel_requested_at" IS NULL
            ORDER BY ("priority" = 'urgent') DESC, "queued_at", "id"
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING "id", "email", "agentId", "task", "priority", "attempt"
    `);

    const row = result.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) return null;

    return {
        id: String(row.id),
        userEmail: String(row.email),
        agentId: String(row.agentId),
        task: String(row.task),
        priority: row.priority as QueuePriority,
        attempt: Number(row.attempt),
    };
}

/** Puts a claimed run back on the queue, for when no capacity was available. */
export async function returnRunToQueue(browserRunId: string): Promise<void> {
    await db.execute(sql`
        UPDATE "browserRun"
        SET "status" = 'queued', "claimed_by" = NULL, "claimed_at" = NULL
        WHERE "id" = ${browserRunId}::uuid AND "status" = 'claimed'
    `);
}

/**
 * Claims a run and the capacity to execute it.
 *
 * The run is claimed first and the slot second, because the slot is keyed by
 * run id: reserving capacity before knowing the run would need a placeholder
 * id, and two workers using the same placeholder would collide on the slot's
 * unique index. Claiming first keeps every write keyed by a real run.
 *
 * When no capacity is free the run goes straight back to the queue, so nothing
 * is stranded in a claimed state.
 */
export async function claimNextRunnableBrowserRun(
    workerId: string,
): Promise<ClaimedBrowserRun | null> {
    const run = await claimNextQueuedRun(workerId);
    if (!run) return null;

    const slotIndex = await acquireBrowserSlot(run.id);

    if (slotIndex === null) {
        await returnRunToQueue(run.id);
        return null;
    }

    return { ...run, slotIndex };
}

/**
 * Requests cancellation. A queued run becomes uncancellable-to-claim
 * immediately; a running one stops receiving further Arkitech-issued input.
 * Neither undoes anything already submitted to a website.
 */
export async function requestCancellation(browserRunId: string, userEmail: string): Promise<boolean> {
    const result = await db.execute(sql`
        UPDATE "browserRun"
        SET "cancel_requested_at" = now(),
            "status" = CASE WHEN "status" = 'queued' THEN 'cancelled' ELSE "status" END
        WHERE "id" = ${browserRunId}::uuid
          AND "email" = ${userEmail}
          AND "status" IN ('queued', 'claimed', 'running')
        RETURNING "id"
    `);

    return Boolean(result.rows?.[0]);
}
