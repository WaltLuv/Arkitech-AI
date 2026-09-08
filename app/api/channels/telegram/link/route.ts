/**
 * Issues a fresh link for a Telegram connection.
 *
 * Codes expire, and a user who wandered off mid-setup needs a new one without
 * disconnecting and re-pasting a token. Issuing also invalidates any unused
 * code for the connection, so there is never more than one working link.
 */
import { loadOwnedConnection } from "@/lib/channels/connections";
import { issueLinkCode } from "@/lib/channels/linking";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const { connectionId } = (await req.json().catch(() => ({}))) as { connectionId?: string };

    if (!connectionId) {
        return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
    }

    const connection = await loadOwnedConnection(connectionId, userEmail);

    if (!connection || connection.provider !== "telegram") {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    if (connection.status === "disconnected") {
        return NextResponse.json(
            { error: "This connection was disconnected. Connect Telegram again." },
            { status: 409 },
        );
    }

    const code = await issueLinkCode({ connectionId: connection.id, userEmail });
    const username = connection.externalAccountLabel?.replace(/^@/, "");

    return NextResponse.json({
        openInTelegram: username ? `https://t.me/${username}?start=${code}` : null,
    });
}
