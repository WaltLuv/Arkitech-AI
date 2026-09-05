-- Opening balance for the Credit Ledger.
--
-- The ledger is the source of truth for spend, and `users.ussageCredits` is a
-- cache of it. Without this, the two disagree the moment the ledger exists: a
-- user holding 100 credits would face a ledger totalling zero, and the
-- dashboard would contradict the balance on the same screen.
--
-- Historical Runs are deliberately not backfilled. The data to reconstruct
-- them accurately does not exist, and inventing it would undermine the
-- ledger's only real claim, that it is accurate. The ledger is authoritative
-- from this point forward.
--
-- Idempotent: the idempotency key is unique per user, so re-running this
-- grants nothing twice.
INSERT INTO "creditLedger" (
	"email",
	"agentId",
	"runId",
	"amount",
	"direction",
	"reason",
	"balance_after",
	"idempotency_key"
)
SELECT
	u."email",
	NULL,
	NULL,
	COALESCE(u."ussageCredits", 0),
	'credit',
	'opening_balance',
	COALESCE(u."ussageCredits", 0),
	'opening_balance:' || u."email"
FROM "users" u
ON CONFLICT ("idempotency_key") DO NOTHING;
