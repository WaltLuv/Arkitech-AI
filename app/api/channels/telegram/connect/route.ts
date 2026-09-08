/**
 * Connecting a Telegram bot.
 *
 * The user pastes a token from BotFather and picks a Team member. Everything
 * after that is Arkitech's job: verifying the bot, sealing the token,
 * registering the webhook with a secret, and handing back a link to open in
 * Telegram. The user never sees a webhook URL and never types a chat id.
 *
 * The token is read from the request body, used, sealed, and not returned. No
 * response from this route contains it, and no log line here prints one.
 */
import { AgentConfig, channelConnection, db } from "@/db";
import { issueLinkCode } from "@/lib/channels/linking";
import { sealSecret } from "@/lib/channels/secrets";
import { getMe, setWebhook } from "@/lib/channels/telegram/client";
import { toConnectionView } from "@/lib/channels/connection-view";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Telegram allows 1-256 characters of A-Z, a-z, 0-9, underscore and hyphen.
 * base64url produces exactly that alphabet; 32 bytes is 43 characters.
 */
function newWebhookSecret(): string {
    return randomBytes(32).toString("base64url");
}

export async function POST(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const { botToken, agentId } = (await req.json().catch(() => ({}))) as {
        botToken?: string;
        agentId?: string;
    };

    if (!botToken?.trim()) {
        return NextResponse.json({ error: "Paste the bot token from BotFather." }, { status: 400 });
    }

    if (!agentId) {
        return NextResponse.json({ error: "Choose which team member should answer." }, { status: 400 });
    }

    // The Team member must be one this user owns. Otherwise a connection could
    // be pointed at somebody else's Agent by id.
    const owned = await db
        .select({ agentId: AgentConfig.agentId })
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)))
        .limit(1);

    if (!owned[0]) {
        return NextResponse.json({ error: "That team member was not found." }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    // Telegram only delivers to HTTPS, so a misconfigured install should say so
    // here rather than fail later inside Telegram with nothing to show the user.
    if (!appUrl?.startsWith("https://")) {
        return NextResponse.json(
            { error: "Telegram can only be connected from a secure (https) Arkitech address." },
            { status: 400 },
        );
    }

    const token = botToken.trim();

    let bot;

    try {
        bot = await getMe(token);
    } catch {
        // Deliberately not the provider's message: it is written for developers
        // and can quote the request.
        return NextResponse.json(
            { error: "That bot token was not accepted by Telegram. Check you copied all of it." },
            { status: 400 },
        );
    }

    const webhookSecret = newWebhookSecret();

    let created;

    try {
        const rows = await db
            .insert(channelConnection)
            .values({
                userEmail,
                provider: "telegram",
                status: "pending_link",
                defaultAgentId: agentId,
                externalAccountId: String(bot.id),
                externalAccountLabel: bot.username ? `@${bot.username}` : bot.first_name,
                secret: sealSecret({ botToken: token, webhookSecret }),
            })
            .returning();

        created = rows[0];
    } catch (e) {
        // The unique index on (provider, external account) is what stops two
        // Arkitech accounts pointing at one bot and receiving each other's
        // conversations.
        if ((e as { code?: string })?.code === "23505") {
            return NextResponse.json(
                { error: "That bot is already connected to an Arkitech account." },
                { status: 409 },
            );
        }

        throw e;
    }

    try {
        await setWebhook(
            token,
            `${appUrl.replace(/\/$/, "")}/api/channels/telegram/webhook/${created.id}`,
            webhookSecret,
        );
    } catch {
        // Nothing works without the webhook, so leave no half-built connection
        // behind for the user to puzzle over.
        await db.delete(channelConnection).where(eq(channelConnection.id, created.id));

        return NextResponse.json(
            { error: "Telegram would not accept the connection. Please try again." },
            { status: 502 },
        );
    }

    const code = await issueLinkCode({ connectionId: created.id, userEmail });

    return NextResponse.json({
        connection: toConnectionView(created),
        // What the user clicks to finish. The code travels inside it, so the
        // person never has to see or type one.
        openInTelegram: bot.username ? `https://t.me/${bot.username}?start=${code}` : null,
    });
}
