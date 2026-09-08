/**
 * The signed-in account's Agent Slot entitlement.
 *
 * The display half of the same seam creation enforces with, so the sidebar
 * cannot advertise a limit the server does not honour. Read-only, and scoped
 * to the session: there is no way to ask about another account, and nothing
 * here accepts a plan, an override, or a limit from the request.
 */
import { getAgentSlotEntitlement } from "@/lib/agent-slots";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? '';

    if (!userEmail) {
        return NextResponse.json({ error: 'Unauthorized User' }, { status: 401 })
    }

    return NextResponse.json(await getAgentSlotEntitlement(userEmail));
}
