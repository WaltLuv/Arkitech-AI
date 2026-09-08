/**
 * Starts a Slack install.
 *
 * Sends the signed-in user to Slack's OAuth screen with a signed state that
 * says which Arkitech account and Team member began it. The state is signed
 * because the request that comes back is otherwise unattributable, and a
 * forged one would attach a workspace to the wrong account.
 */
import { AgentConfig, db } from "@/db";
import { signState } from "@/lib/channels/state";
import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Only what a direct-message conversation needs: post replies, and see the
 * direct messages people send the app. Nothing that reads channels.
 */
const SCOPES = ["chat:write", "im:history"];

export async function GET(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const clientId = process.env.SLACK_CLIENT_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!clientId || !appUrl) {
        return NextResponse.json(
            { error: "Slack is not available on this Arkitech install yet." },
            { status: 503 },
        );
    }

    const agentId = req.nextUrl.searchParams.get("agentId");

    if (!agentId) {
        return NextResponse.json({ error: "Choose which team member should answer." }, { status: 400 });
    }

    const owned = await db
        .select({ agentId: AgentConfig.agentId })
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)))
        .limit(1);

    if (!owned[0]) {
        return NextResponse.json({ error: "That team member was not found." }, { status: 404 });
    }

    const authorize = new URL("https://slack.com/oauth/v2/authorize");
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("scope", SCOPES.join(","));
    authorize.searchParams.set("redirect_uri", `${appUrl.replace(/\/$/, "")}/api/channels/slack/callback`);
    authorize.searchParams.set("state", signState({ userEmail, agentId }));

    return NextResponse.redirect(authorize.toString());
}
