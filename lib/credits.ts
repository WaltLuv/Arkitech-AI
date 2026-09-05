/**
 * Credit accounting helpers used before and after agent executions.
 */
import { db, users } from "@/db";
import { and, eq, gt, sql } from "drizzle-orm";

export async function deductUsageCredit(userEmail: string) {
    // The WHERE clause makes this deduction atomic and prevents negative balances.
    const result = await db.update(users)
        .set({
            usageCredits: sql`${users.usageCredits} - 1`,
        })
        .where(and(eq(users.email, userEmail), gt(users.usageCredits, 0)))
        .returning({
            usageCredits: users.usageCredits,
        });

    return result[0] ?? null;
}

export async function refundUsageCredit(userEmail: string) {
    // Used only when a queued execution fails before it is handed to Inngest.
    await db.update(users)
        .set({
            usageCredits: sql`${users.usageCredits} + 1`,
        })
        .where(eq(users.email, userEmail));
}
