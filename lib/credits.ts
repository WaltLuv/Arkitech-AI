/**
 * Credit accounting. Every Usage Credit movement writes a Credit Ledger entry;
 * nothing changes a balance without one.
 *
 * The ledger is the source of truth for spend. `users.usageCredits` is a cache
 * of it, and the two are kept in step by making each movement a single SQL
 * statement rather than a transaction: the neon-http driver has no transaction
 * support, and a statement is atomic on its own.
 */
import { db, users } from "@/db";
import { sql } from "drizzle-orm";

/** Why a credit moved. Recorded on every entry. */
export const REFUND_REASONS = [
    "platform_failure",
    "worker_failure",
    "provider_failure",
    "agent_failure",
    "cancelled_before_execution",
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

/**
 * Price per Execution Mode. Only `standard` exists today. The charged cost is
 * stored on the Run, so adding a mode at a different price needs no ledger
 * change and never restates a past Run.
 */
export const CREDIT_COST_BY_EXECUTION_MODE = { standard: 1 } as const;

export type ExecutionMode = keyof typeof CREDIT_COST_BY_EXECUTION_MODE;

export function creditCostFor(mode: ExecutionMode = "standard"): number {
    return CREDIT_COST_BY_EXECUTION_MODE[mode];
}

/** A charge is attempted at most once per Run, and a refund at most once. */
const chargeKey = (runId: string) => `charge:${runId}`;
const refundKey = (runId: string) => `refund:${runId}`;

/** Postgres unique-violation. Here it means "this movement already happened". */
const isDuplicate = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23505";

/**
 * A charge has three distinct outcomes, and callers must tell them apart.
 * Collapsing "already charged" into "insufficient" makes a retried worker step
 * fail a Run that was in fact paid for.
 */
export type ChargeResult =
    | { outcome: "charged"; balance: number }
    | { outcome: "already_charged" }
    | { outcome: "insufficient" };

export type RefundResult =
    | { outcome: "refunded"; balance: number }
    | { outcome: "already_refunded" };

/** True when the Run is paid for, however it got that way. */
export function isPaid(result: ChargeResult): boolean {
    return result.outcome === "charged" || result.outcome === "already_charged";
}

type Movement = {
    userEmail: string;
    agentId: string | null;
    runId: string;
    cost: number;
};

/**
 * Charge a Run at acceptance.
 *
 * A retry is a no-op rather than a second debit, and reports `already_charged`
 * so the caller can tell it apart from the user being out of credit.
 *
 * The guard lives in the UPDATE's WHERE clause, so a balance can never go
 * negative however many Runs are accepted at once. If the ledger insert then
 * violates the unique key, the whole statement aborts and the decrement is
 * rolled back with it: that is what makes a duplicate safe without a
 * transaction.
 */
export async function chargeRun({
    userEmail,
    agentId,
    runId,
    cost,
}: Movement): Promise<ChargeResult> {
    try {
        const result = await db.execute(sql`
            WITH deducted AS (
                UPDATE ${users}
                SET "ussageCredits" = "ussageCredits" - ${cost}
                WHERE "email" = ${userEmail}
                  AND "ussageCredits" >= ${cost}
                RETURNING "ussageCredits" AS balance
            )
            INSERT INTO "creditLedger" (
                "email", "agentId", "runId", "amount", "direction",
                "reason", "balance_after", "idempotency_key"
            )
            SELECT ${userEmail}, ${agentId}, ${runId}::uuid, ${cost}, 'debit',
                   'run_accepted', deducted.balance, ${chargeKey(runId)}
            FROM deducted
            RETURNING "balance_after" AS balance
        `);

        const row = result.rows?.[0] as { balance?: number } | undefined;

        // No row means the guard matched nothing: the user cannot afford it.
        return row?.balance == null
            ? { outcome: "insufficient" }
            : { outcome: "charged", balance: Number(row.balance) };
    } catch (error) {
        // Already charged. The decrement rolled back with the failed insert.
        if (isDuplicate(error)) return { outcome: "already_charged" };
        throw error;
    }
}

/**
 * Refund a Run's Credit Cost.
 *
 * Applies identically to scheduled and on-demand Runs. Issued at most once per
 * Run: a second attempt is absorbed by the unique key, taking the increment
 * with it, so a retried worker step cannot hand back two credits.
 */
export async function refundRun({
    userEmail,
    agentId,
    runId,
    cost,
    reason,
}: Movement & { reason: RefundReason }): Promise<RefundResult> {
    try {
        const result = await db.execute(sql`
            WITH restored AS (
                UPDATE ${users}
                SET "ussageCredits" = "ussageCredits" + ${cost}
                WHERE "email" = ${userEmail}
                RETURNING "ussageCredits" AS balance
            )
            INSERT INTO "creditLedger" (
                "email", "agentId", "runId", "amount", "direction",
                "reason", "balance_after", "idempotency_key"
            )
            SELECT ${userEmail}, ${agentId}, ${runId}::uuid, ${cost}, 'credit',
                   ${reason}, restored.balance, ${refundKey(runId)}
            FROM restored
            RETURNING "balance_after" AS balance
        `);

        const row = result.rows?.[0] as { balance?: number } | undefined;

        return row?.balance == null
            ? { outcome: "already_refunded" }
            : { outcome: "refunded", balance: Number(row.balance) };
    } catch (error) {
        // Already refunded. The increment rolled back with the failed insert.
        if (isDuplicate(error)) return { outcome: "already_refunded" };
        throw error;
    }
}
