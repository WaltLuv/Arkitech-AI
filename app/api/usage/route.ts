/**
 * Per-Agent Usage Credit spend for the signed-in user, read from the ledger.
 */
import { AgentConfig, creditLedger, db, users } from "@/db";
import { summariseUsage } from "@/lib/usage-summary";
import { currentUser } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';

    if (!userEmail) {
        return NextResponse.json({ error: 'Unauthorized User' }, { status: 401 })
    }

    // Scoped to the caller in the query. A user can only ever read their own
    // spend, whatever they put in the request.
    const entries = await db
        .select({
            agentId: creditLedger.agentId,
            amount: creditLedger.amount,
            direction: creditLedger.direction,
            reason: creditLedger.reason,
            createdAt: creditLedger.createdAt,
        })
        .from(creditLedger)
        .where(eq(creditLedger.userEmail, userEmail))
        .orderBy(desc(creditLedger.createdAt));

    const summary = summariseUsage(entries);

    // Names for display. Spend for a deleted Agent is still reported, just
    // without a name, so history does not vanish when a user cleans up.
    const agents = await db
        .select({ agentId: AgentConfig.agentId, name: AgentConfig.name })
        .from(AgentConfig)
        .where(eq(AgentConfig.userEmail, userEmail));

    const nameFor = new Map(agents.map(a => [a.agentId, a.name]));

    const balanceRows = await db
        .select({ balance: users.usageCredits })
        .from(users)
        .where(eq(users.email, userEmail));

    return NextResponse.json({
        balance: balanceRows[0]?.balance ?? 0,
        totalNet: summary.totalNet,
        systemCredits: summary.systemCredits,
        perAgent: summary.perAgent.map(entry => ({
            ...entry,
            name: nameFor.get(entry.agentId) ?? null,
        })),
    });
}
