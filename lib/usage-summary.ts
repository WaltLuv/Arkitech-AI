/**
 * Per-Agent spend, computed from Credit Ledger entries.
 *
 * Pure on purpose: the interesting rules (refunds netted out, system entries
 * excluded from Agent attribution) are then testable without a database.
 */

export type LedgerRow = {
    agentId: string | null;
    amount: number;
    direction: string;
    reason: string;
    createdAt: Date | string;
};

export type AgentSpend = {
    agentId: string;
    spent: number;
    refunded: number;
    net: number;
};

export type UsageSummary = {
    /** Per Agent, highest net spend first. */
    perAgent: AgentSpend[];
    /** Net spend across every Agent. */
    totalNet: number;
    /** Movements that belong to no Agent, such as the opening balance. */
    systemCredits: number;
};

const isDebit = (row: LedgerRow) => row.direction === "debit";

/**
 * Nets refunds against charges. A Run that was charged and then refunded
 * contributes nothing, which is what makes this agree with the balance.
 */
export function summariseUsage(
    rows: LedgerRow[],
    range?: { from?: Date; to?: Date },
): UsageSummary {
    const byAgent = new Map<string, AgentSpend>();
    let systemCredits = 0;

    for (const row of rows) {
        const at = new Date(row.createdAt);
        if (range?.from && at < range.from) continue;
        if (range?.to && at > range.to) continue;

        // Entries with no Agent are real movements but are not Agent spend.
        // Attributing the opening balance to an Agent would invent history.
        if (!row.agentId) {
            if (!isDebit(row)) systemCredits += row.amount;
            continue;
        }

        const entry = byAgent.get(row.agentId) ?? {
            agentId: row.agentId,
            spent: 0,
            refunded: 0,
            net: 0,
        };

        if (isDebit(row)) entry.spent += row.amount;
        else entry.refunded += row.amount;

        entry.net = entry.spent - entry.refunded;
        byAgent.set(row.agentId, entry);
    }

    const perAgent = [...byAgent.values()].sort(
        (a, b) => b.net - a.net || a.agentId.localeCompare(b.agentId),
    );

    return {
        perAgent,
        totalNet: perAgent.reduce((sum, entry) => sum + entry.net, 0),
        systemCredits,
    };
}
