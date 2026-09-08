/**
 * A conversation's transcript, for the web surface.
 *
 * Owner-scoped twice over: the conversation must belong to the caller, and the
 * messages are queried by owner as well. A conversation id is a uuid, not a
 * capability.
 */
import { conversation, db } from "@/db";
import { loadConversationMessages } from "@/lib/channels/conversations";
import { currentUser } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Enough to reopen a chat where it was left, without loading a year of it. */
const TRANSCRIPT_LIMIT = 50;

export async function GET(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const agentId = req.nextUrl.searchParams.get("agentId");

    if (!agentId) {
        return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }

    // The web conversation for this Team member, if one has been started.
    const rows = await db
        .select()
        .from(conversation)
        .where(
            and(
                eq(conversation.userEmail, userEmail),
                eq(conversation.agentId, agentId),
                eq(conversation.channel, "web"),
                eq(conversation.status, "active"),
            ),
        )
        .orderBy(desc(conversation.lastMessageAt))
        .limit(1);

    if (!rows[0]) {
        return NextResponse.json({ conversationId: null, messages: [] });
    }

    const messages = await loadConversationMessages({
        conversationId: rows[0].id,
        userEmail,
        limit: TRANSCRIPT_LIMIT,
    });

    return NextResponse.json({
        conversationId: rows[0].id,
        messages: messages
            // A reply that never reached the person is not part of what they
            // saw, and showing it as said would be a lie about the exchange.
            .filter(row => row.status !== "failed" && row.body)
            .map(row => ({
                id: row.id,
                role: row.direction === "inbound" ? "user" : "agent",
                content: row.body,
                createdAt: row.createdAt,
            })),
    });
}
