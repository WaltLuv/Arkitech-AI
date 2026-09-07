/**
 * Site policy for one of the caller's Agents: read it, or replace it.
 *
 * The Agent is resolved through ownership first, so a policy can only be
 * read or written by the person who owns the Agent. The body is validated by
 * the same parser the enforcer trusts, which refuses every always-blocked
 * destination: there is no request that makes localhost or a metadata
 * endpoint allowed.
 */
import { loadOwnedAgent } from "@/lib/agent-ownership";
import { loadSitePolicy, saveSitePolicy } from "@/lib/browserbase/policy";
import { parseSitePolicy } from "@/lib/browserbase/site-policy";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const agentId = req.nextUrl.searchParams.get("agentId") ?? "";
    const ownership = await loadOwnedAgent(agentId, userEmail);
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status });

    const policy = await loadSitePolicy(ownership.agent.agentId, userEmail);
    return NextResponse.json({ agentId: ownership.agent.agentId, policy });
}

export async function PUT(req: NextRequest) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const body = await req.json().catch(() => null) as { agentId?: unknown; policy?: unknown } | null;
    const agentId = typeof body?.agentId === "string" ? body.agentId : "";

    const ownership = await loadOwnedAgent(agentId, userEmail);
    if (!ownership.ok) return NextResponse.json({ error: ownership.error }, { status: ownership.status });

    const parsed = parseSitePolicy(body?.policy);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const saved = await saveSitePolicy(ownership.agent.agentId, userEmail, parsed.policy);
    if (!saved) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

    return NextResponse.json({ agentId: ownership.agent.agentId, policy: parsed.policy });
}
