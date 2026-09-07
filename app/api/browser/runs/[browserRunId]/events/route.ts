/**
 * Activity for one run, oldest first. Details are the safe structured
 * metadata the recorder allowed; anything else was refused at write time.
 */
import { browserEvent, db } from "@/db";
import { loadOwnedBrowserRun } from "@/lib/browserbase/operator";
import { currentUser } from "@clerk/nextjs/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: Promise<{ browserRunId: string }> }) {
    const user = await currentUser();
    const userEmail = user?.primaryEmailAddress?.emailAddress ?? "";
    if (!userEmail) return NextResponse.json({ error: "Unauthorized User" }, { status: 401 });

    const { browserRunId } = await context.params;
    const run = await loadOwnedBrowserRun(browserRunId, userEmail);
    if (!run) return NextResponse.json({ error: "Browser run not found" }, { status: 404 });

    const afterParam = Number(req.nextUrl.searchParams.get("after") ?? "0");
    const after = Number.isFinite(afterParam) && afterParam > 0 ? afterParam : 0;

    const events = await db
        .select({
            sequence: browserEvent.sequence,
            kind: browserEvent.kind,
            actor: browserEvent.actor,
            detail: browserEvent.detail,
            createdAt: browserEvent.createdAt,
        })
        .from(browserEvent)
        .where(and(
            eq(browserEvent.browserRunId, run.id),
            eq(browserEvent.userEmail, userEmail),
            gt(browserEvent.sequence, after),
        ))
        .orderBy(asc(browserEvent.sequence))
        .limit(500);

    return NextResponse.json({ events });
}
