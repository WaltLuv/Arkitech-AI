/**
 * API route that returns connected-account details for a selected integration toolkit.
 */
import { composio } from "@/lib/composio";
import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {

    const user = await currentUser();

    const { slug } = await req.json();

    const authConfig = await composio.authConfigs.create(slug);

    const connection = await composio.connectedAccounts.link(user?.primaryEmailAddress?.emailAddress ?? '', authConfig.id)

    console.log(connection)

    return NextResponse.json({
        redirectUrl: connection.redirectUrl
    })
}


export async function DELETE(req: NextRequest) {
    const { connectedAccountId } = await req.json();

    await composio.connectedAccounts.disable(connectedAccountId);

    return NextResponse.json({ 'success': true })
}