/**
 * Telegram's webhook.
 *
 * Deliberately outside Clerk: the caller is Telegram, which has no Arkitech
 * session. Authentication is the secret token instead. Arkitech registers the
 * webhook with a `secret_token`, Telegram sends it back in every request as
 * X-Telegram-Bot-Api-Secret-Token, and a request without the matching value is
 * refused before anything is read from its body.
 *
 * The connection id in the path is not a secret and is not treated as one. It
 * says which connection to check the header against, and nothing more.
 *
 * This route answers 200 for everything it has decided about, including
 * refusals and duplicates, because a non-2xx tells Telegram to deliver the same
 * update again. 500 is reserved for the case where a retry is genuinely wanted.
 */
import { channelConnection, db } from "@/db";
import { receiveInboundMessage } from "@/lib/channels/inbound";
import { sendChannelNotice } from "@/lib/channels/outbound";
import { telegramCredentials } from "@/lib/channels/telegram/adapter";
import { parseTelegramUpdate } from "@/lib/channels/telegram/parse";
import { eq } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Constant-time, and false rather than throwing when the lengths differ. */
function secretMatches(provided: string | null, expected: string): boolean {
    if (!provided) {
        return false;
    }

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);

    return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
    const { connectionId } = await context.params;

    // A malformed id is not a connection. Answered as 403 like every other
    // failure to authenticate, so probing the path cannot tell an existing
    // connection from a missing one.
    const rows = await db
        .select()
        .from(channelConnection)
        .where(eq(channelConnection.id, connectionId))
        .limit(1)
        .catch(() => []);

    const connection = rows[0];

    if (!connection || connection.provider !== "telegram") {
        return NextResponse.json({ ok: false }, { status: 403 });
    }

    let expectedSecret: string;

    try {
        expectedSecret = telegramCredentials(connection).webhookSecret;
    } catch {
        // Unopenable credentials mean this connection cannot be trusted to
        // authenticate anything. Refuse rather than fall through.
        return NextResponse.json({ ok: false }, { status: 403 });
    }

    if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), expectedSecret)) {
        return NextResponse.json({ ok: false }, { status: 403 });
    }

    const update = await req.json().catch(() => null);

    if (!update) {
        return NextResponse.json({ ok: true });
    }

    const inbound = parseTelegramUpdate(update);

    if (!inbound) {
        // An update type Arkitech does not act on. Acknowledged so Telegram
        // stops offering it.
        return NextResponse.json({ ok: true });
    }

    let outcome;

    try {
        outcome = await receiveInboundMessage({ connection, inbound });
    } catch {
        // Something Arkitech could not complete. 500 asks Telegram to deliver
        // it again, which is right: the pipeline undoes its own claim before
        // throwing, so the retry is processed rather than deduplicated away.
        return NextResponse.json({ ok: false }, { status: 500 });
    }

    // Refusals and linking confirmations are answered in the chat. This is one
    // short API call, and the person is waiting on it.
    const reply =
        outcome.outcome === "linked"
            ? outcome.reply
            : outcome.outcome === "refused"
              ? outcome.reply
              : null;

    if (reply) {
        await sendChannelNotice({
            connection,
            externalChatId: inbound.externalChatId,
            text: reply,
            replyToExternalMessageId: inbound.externalMessageId,
        }).catch(() => {
            // A refusal that could not be delivered is still a refusal. Never
            // turn it into a retry: Telegram would replay the same rejected
            // update indefinitely.
        });
    }

    return NextResponse.json({ ok: true });
}
