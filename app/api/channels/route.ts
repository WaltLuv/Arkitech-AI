/**
 * The connections a signed-in user has, in the shape the Connections screen
 * shows them. Never returns a credential; see lib/channels/connection-view.ts.
 */
import { listConnections } from "@/lib/channels/connections";
import { toConnectionView } from "@/lib/channels/connection-view";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";

    if (!userEmail) {
        return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });
    }

    const connections = await listConnections(userEmail);

    return NextResponse.json(connections.map(toConnectionView));
}
