/**
 * Finishes a Slack install.
 *
 * Slack returns here with a code. The signed state says whose install it is,
 * and it is the only thing trusted from the query string: the code is
 * exchanged server-side and the resulting token never reaches a browser.
 *
 * Redirects back to Connections either way, with a short outcome the screen can
 * put into words. Nothing about the failure goes in the URL beyond a code.
 */
import { channelConnection, db } from "@/db";
import { sealSecret } from "@/lib/channels/secrets";
import { exchangeOAuthCode } from "@/lib/channels/slack/client";
import { slackAccountKey } from "@/lib/channels/slack/identity";
import { verifyState } from "@/lib/channels/state";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function back(appUrl: string, outcome: string) {
    return NextResponse.redirect(`${appUrl.replace(/\/$/, "")}/dashboard/settings?slack=${outcome}`);
}

export async function GET(req: NextRequest) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

    if (!appUrl || !clientId || !clientSecret) {
        return back(appUrl || "", "unavailable");
    }

    // Slack sends the user back here after a refusal too.
    if (req.nextUrl.searchParams.get("error")) {
        return back(appUrl, "cancelled");
    }

    const state = verifyState(req.nextUrl.searchParams.get("state"));
    const code = req.nextUrl.searchParams.get("code");

    if (!state || !code) {
        return back(appUrl, "expired");
    }

    let install;

    try {
        install = await exchangeOAuthCode({
            code,
            clientId,
            clientSecret,
            redirectUri: `${appUrl.replace(/\/$/, "")}/api/channels/slack/callback`,
        });
    } catch {
        return back(appUrl, "failed");
    }

    const installer = install.authed_user?.id;

    if (!installer) {
        return back(appUrl, "failed");
    }

    const accountKey = slackAccountKey(install.team.id, installer);

    // Reconnecting the same workspace and person updates the existing row
    // rather than colliding with it, which is what makes disconnect and
    // reconnect work rather than dead-ending on the unique index.
    const existing = await db
        .select()
        .from(channelConnection)
        .where(eq(channelConnection.externalAccountId, accountKey))
        .limit(1);

    if (existing[0]) {
        // A workspace already attached to a different Arkitech account is not
        // reattached silently. That would move one customer's channel to
        // another's Team member.
        if (existing[0].userEmail !== state.userEmail) {
            return back(appUrl, "already_connected");
        }

        await db
            .update(channelConnection)
            .set({
                status: "active",
                statusReason: null,
                defaultAgentId: state.agentId,
                externalAccountLabel: install.team.name,
                secret: sealSecret({ botToken: install.access_token }),
                authorizedExternalUserId: installer,
                updatedAt: new Date(),
            })
            .where(eq(channelConnection.id, existing[0].id));

        return back(appUrl, "connected");
    }

    await db.insert(channelConnection).values({
        userEmail: state.userEmail,
        provider: "slack",
        // Active immediately: installing the app from inside the workspace,
        // while signed in to Arkitech, is the proof of ownership. There is no
        // second linking step to wait for.
        status: "active",
        defaultAgentId: state.agentId,
        externalAccountId: accountKey,
        externalAccountLabel: install.team.name,
        secret: sealSecret({ botToken: install.access_token }),
        authorizedExternalUserId: installer,
    });

    return back(appUrl, "connected");
}
