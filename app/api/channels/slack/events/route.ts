/**
 * Slack's Events API endpoint.
 *
 * One URL for the whole Arkitech Slack app, because Slack delivers events per
 * app rather than per install. Which customer an event belongs to is decided by
 * `team_id` in the verified payload, never by anything in the URL.
 *
 * Outside Clerk, like the Telegram webhook, and authenticated the same way in
 * spirit: an HMAC signature over the raw body, checked before the body is
 * parsed or trusted. The raw text is read first and parsed afterwards, because
 * re-serialising parsed JSON produces different bytes and would fail every
 * signature check.
 *
 * Slack expects a 200 within three seconds and retries up to three times
 * otherwise, so this route decides, acknowledges, and leaves the work to the
 * background function.
 */
import { channelConnection, db } from "@/db";
import { receiveInboundMessage } from "@/lib/channels/inbound";
import { sendChannelNotice } from "@/lib/channels/outbound";
import { slackAccountKey } from "@/lib/channels/slack/identity";
import { parseSlackEvent } from "@/lib/channels/slack/parse";
import { verifySlackRequest } from "@/lib/channels/slack/verify";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const raw = await req.text();

    const verification = verifySlackRequest({
        signingSecret: process.env.SLACK_SIGNING_SECRET,
        body: raw,
        signature: req.headers.get("x-slack-signature"),
        timestamp: req.headers.get("x-slack-request-timestamp"),
    });

    if (!verification.valid) {
        return NextResponse.json({ ok: false }, { status: 403 });
    }

    const payload = (() => {
        try {
            return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return null;
        }
    })();

    if (!payload) {
        return NextResponse.json({ ok: true });
    }

    // Slack proves an endpoint is really ours by asking it to echo a challenge.
    // Signed like any other request, so this is checked above first.
    if (payload.type === "url_verification") {
        return NextResponse.json({ challenge: payload.challenge });
    }

    const teamId = typeof payload.team_id === "string" ? payload.team_id : null;

    if (!teamId) {
        return NextResponse.json({ ok: true });
    }

    const inbound = parseSlackEvent(payload);

    if (!inbound) {
        return NextResponse.json({ ok: true });
    }

    // A connection is a workspace and a person, not a workspace alone: two
    // Arkitech customers can work in the same Slack workspace. The sender is
    // half the key, so a colleague who messages the app resolves to no
    // connection and reaches nothing.
    const rows = await db
        .select()
        .from(channelConnection)
        .where(
            and(
                eq(channelConnection.provider, "slack"),
                eq(
                    channelConnection.externalAccountId,
                    slackAccountKey(teamId, inbound.externalUserId),
                ),
            ),
        )
        .limit(1);

    const connection = rows[0];

    if (!connection) {
        // Nobody Arkitech knows. Acknowledged rather than refused: a 403 would
        // have Slack retry it three more times to the same conclusion.
        return NextResponse.json({ ok: true });
    }

    let outcome;

    try {
        outcome = await receiveInboundMessage({ connection, inbound });
    } catch {
        return NextResponse.json({ ok: false }, { status: 500 });
    }

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
            // Same reasoning as Telegram: an undeliverable refusal must not
            // become a retry loop.
        });
    }

    return NextResponse.json({ ok: true });
}
