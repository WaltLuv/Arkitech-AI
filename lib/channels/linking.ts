/**
 * One-time codes that bind an external chat to an Arkitech account.
 *
 * A bot's username is public and anybody can open a chat with it, so reaching
 * the bot proves nothing. What proves something is carrying a code that only a
 * signed-in Arkitech user could have been given. The first valid presentation
 * links that chat and burns the code; everyone else is refused before any Agent
 * is built.
 *
 * The code is stored as a sha256 hash. Arkitech shows it once, at issue, and
 * never needs it again, so keeping the plaintext would be a liability with no
 * corresponding use.
 */
import { channelLinkCode, db } from "@/db";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

/**
 * Long enough not to be guessable, and inside Telegram's 64-character limit on
 * a deep-link start payload, whose alphabet is A-Z a-z 0-9 _ and - .
 */
const CODE_BYTES = 16;

/** Short-lived: a link code is carried from one screen into another app. */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export function hashLinkCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
}

/**
 * Issue a code for a connection, returning the plaintext exactly once.
 *
 * Any unused codes for the connection are dropped first, so a user who restarts
 * the flow cannot leave a second working code alive behind them.
 */
export async function issueLinkCode({
    connectionId,
    userEmail,
}: {
    connectionId: string;
    userEmail: string;
}): Promise<string> {
    await db
        .delete(channelLinkCode)
        .where(and(eq(channelLinkCode.connectionId, connectionId), isNull(channelLinkCode.usedAt)));

    const code = randomBytes(CODE_BYTES).toString("base64url");

    await db.insert(channelLinkCode).values({
        connectionId,
        userEmail,
        codeHash: hashLinkCode(code),
        expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
    });

    return code;
}

/**
 * Redeem a code, at most once.
 *
 * Single-use is enforced by the UPDATE's own predicate rather than by reading
 * the row and then writing it: two people presenting the same code at the same
 * moment both pass a read, and only one can pass this.
 */
export async function redeemLinkCode(code: string): Promise<{
    connectionId: string;
    userEmail: string;
} | null> {
    const redeemed = await db
        .update(channelLinkCode)
        .set({ usedAt: new Date() })
        .where(
            and(
                eq(channelLinkCode.codeHash, hashLinkCode(code)),
                isNull(channelLinkCode.usedAt),
                gt(channelLinkCode.expiresAt, sql`now()`),
            ),
        )
        .returning({
            connectionId: channelLinkCode.connectionId,
            userEmail: channelLinkCode.userEmail,
        });

    return redeemed[0] ?? null;
}
