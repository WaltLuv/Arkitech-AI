/**
 * API route that lists persisted run history for the authenticated user.
 */
import { AgentConfig, AgentRun, db } from "@/db";
import { currentUser } from "@clerk/nextjs/server";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {

    const user = await currentUser();

    const result = await db.select({
        id: AgentRun.id,
        agentId: AgentRun.agentId,
        email: AgentRun.userEmail,
        status: AgentRun.status,
        output: AgentRun.output,
        error: AgentRun.error,
        scheduledFor: AgentRun.scheduledFor,
        completedAt: AgentRun.completedAt,
        createdAt: AgentRun.createdAt,
        name: AgentConfig.name,
        agentImage: AgentConfig?.agentImage,
        task: AgentConfig?.description
    }).from(AgentRun)
        .leftJoin(AgentConfig, eq(AgentRun.agentId, AgentConfig.agentId))
        .where(eq(AgentRun.userEmail, user?.primaryEmailAddress?.emailAddress ?? ''))
        .orderBy(desc(AgentRun.createdAt))
        ;

    return NextResponse.json(result);

}
