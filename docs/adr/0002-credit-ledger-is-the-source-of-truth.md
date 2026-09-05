# The Credit Ledger is the source of truth for spend

Usage Credits were tracked as a single mutable integer on the user row, which cannot answer "which Agent spent this", cannot distinguish a refunded Run from one that never ran, and cannot stop a retried worker step from refunding twice. We introduced an append-only Credit Ledger as the authoritative record of every credit movement, and demoted `users.usageCredits` to a cache of it, updated in the same transaction as the entry that changes it.

## Considered Options

Keeping the balance column authoritative and deriving reporting from `AgentRun` rows. Rejected because it cannot represent refunds: a failed Run that was refunded and a failed Run that was not look identical in the run table, so any per-Agent spend figure would be wrong in exactly the cases users ask about.

Dropping the cached balance entirely and summing the ledger on every read. Rejected as an unnecessary migration risk and a hot-path cost, for a number that is read on nearly every page.

## Consequences

Idempotency is enforced by a unique key derived from the Run and the reason, not by convention. A repeated write is a no-op returning the existing entry, which is what makes Inngest step retries safe by construction rather than by luck.

Credit Cost is captured on the Run at acceptance, so changing the price of an Execution Mode never rewrites history. This is what allows computer Runs to cost 5 while past Runs stay at what they were actually charged.

The cached balance can drift. That is an accepted, detectable cost: the ledger can always reconstruct the true balance, so drift is a reconciliation bug rather than lost data.

Nothing is charged for a schedule, only for an Occurrence that is accepted and becomes a Run.
