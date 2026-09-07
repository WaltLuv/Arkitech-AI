/**
 * Liveness and readiness for the deployment host.
 *
 * Deliberately unauthenticated, because a health check that needs a session
 * cannot tell a load balancer whether the process is up. That makes what it
 * returns a security question: booleans and states only, never a value, a
 * connection string, a key, or anything that would help someone map the
 * install. "Configured" is the most it will say about a credential.
 */
import { db } from "@/db";
import { isBrowserbaseConfigured } from "@/lib/browserbase/client";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Set by the host from the deployed commit, where the host provides one. */
const COMMIT =
    process.env.RENDER_GIT_COMMIT ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    null;

export async function GET() {
    let database: "ok" | "unreachable" = "unreachable";

    try {
        await db.execute(sql`SELECT 1`);
        database = "ok";
    } catch {
        // The reason is deliberately dropped: a driver error carries the
        // connection string, and this response is public.
        database = "unreachable";
    }

    const healthy = database === "ok";

    return NextResponse.json(
        {
            status: healthy ? "ok" : "degraded",
            commit: COMMIT ? COMMIT.slice(0, 7) : null,
            database,
            browserExecution: isBrowserbaseConfigured() ? "configured" : "not_configured",
            time: new Date().toISOString(),
        },
        { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
}
