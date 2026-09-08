/**
 * Inbound event deduplication.
 *
 * Both providers retry. Telegram re-delivers an update when the webhook did not
 * answer in time; Slack retries up to three times when it does not get a 200
 * within three seconds, so one event can arrive four times. Handling it twice
 * would build the Agent twice, spend two Usage Credits and send the person two
 * replies.
 *
 * The claim is an insert, not a check. Two retries can arrive at once and a
 * read-then-write would let both through, and the neon-http driver has no
 * transactions to close that window. A unique index does: exactly one insert
 * wins, and the loser is told to stop.
 */
import { channelInboundEvent, db } from "@/db";
import { lt } from "drizzle-orm";

/**
 * True when this caller owns the event and should process it. False means
 * another delivery of the same event already did.
 */
export async function claimInboundEvent({
    connectionId,
    provider,
    externalEventId,
}: {
    connectionId: string;
    provider: string;
    externalEventId: string;
}): Promise<boolean> {
    const inserted = await db
        .insert(channelInboundEvent)
        .values({ connectionId, provider, externalEventId })
        .onConflictDoNothing({
            target: [
                channelInboundEvent.connectionId,
                channelInboundEvent.provider,
                channelInboundEvent.externalEventId,
            ],
        })
        .returning({ id: channelInboundEvent.id });

    return inserted.length > 0;
}

/**
 * Drop claims old enough that no provider would still retry them.
 *
 * Retries are measured in seconds and minutes, so a day is generous. Without
 * this the table grows for the life of the install.
 */
export async function sweepInboundEvents(olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
    await db
        .delete(channelInboundEvent)
        .where(lt(channelInboundEvent.createdAt, new Date(Date.now() - olderThanMs)));
}
