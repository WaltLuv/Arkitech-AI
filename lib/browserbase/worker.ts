/**
 * Executes one claimed browser run from start to finish.
 *
 * Sequence: mark running, open a session, take the agent lease, let the
 * model drive through `BrowserbaseComputer`, then finish, release the session
 * and free the slot, whatever happened. Every outcome is written to the run
 * and to the activity trail; nothing ends silently.
 *
 * The Usage Credit for browser work is the existing Run charge. Nothing here
 * touches the ledger.
 */
import { AgentConfig, browserRun, db } from "@/db";
import { Agent, computerTool, run as runAgent } from "@openai/agents";
import { and, eq, sql } from "drizzle-orm";
import { recordEventWithRetry } from "./activity";
import { BrowserbaseComputer, HandoverTimeoutError, RunCancelledError, productionComputerDeps } from "./computer";
import { grantControl, revokeControl } from "./control";
import * as driver from "./driver";
import { AGENT_VIEWPORT } from "./input-mapping";
import { releaseBrowserSlot, type ClaimedBrowserRun } from "./queue";
import { openSessionForRun, releaseSessionForRecord } from "./session";

/** Turns the model may take before the run is stopped for its own good. */
export const MAX_AGENT_TURNS = 60;

export const DEFAULT_COMPUTER_MODEL = "computer-use-preview";

export type WorkerOutcome =
    | { status: "completed"; result: string }
    | { status: "failed"; reason: string }
    | { status: "cancelled" };

/** True once Stop has been requested; read fresh each time, never cached. */
async function cancellationRequested(browserRunId: string): Promise<boolean> {
    const result = await db.execute(sql`
        SELECT 1 FROM "browserRun"
        WHERE "id" = ${browserRunId}::uuid AND "cancel_requested_at" IS NOT NULL
    `);
    return Boolean(result.rows?.[0]);
}

/** The agent's live generation for this worker, or null while someone else holds control. */
async function agentGenerationFor(browserRunId: string, userEmail: string, workerId: string): Promise<number | null> {
    const result = await db.execute(sql`
        SELECT "generation" FROM "browserControlLease"
        WHERE "browser_run_id" = ${browserRunId}::uuid
          AND "email" = ${userEmail}
          AND "holder_kind" = 'agent'
          AND "holder_id" = ${workerId}
          AND ("expires_at" IS NULL OR "expires_at" > now())
    `);
    const row = result.rows?.[0] as { generation?: number } | undefined;
    return row?.generation == null ? null : Number(row.generation);
}

function instructionsFor(agentName: string, task: string): string {
    return `
You are ${agentName}, operating a web browser on behalf of the user.

Task:
${task}

Rules:
- Work only in the browser you are given. Take a screenshot before acting when the page may have changed.
- Never enter passwords, one-time codes or payment details. If a site asks for them, stop and report that a person must take over.
- Never claim a step succeeded unless the screenshot shows it.
- If control is taken from you and later returned, the page may have changed: look again before continuing.
- When the task is complete, or cannot be completed, reply with a short plain-language report of what happened and what was observed.
`.trim();
}

/**
 * Runs the whole thing. Errors are outcomes here, not exceptions, so the
 * caller can persist them without a second try/catch.
 */
export async function executeBrowserRun(claimed: ClaimedBrowserRun, workerId: string): Promise<WorkerOutcome> {
    const { id: browserRunId, userEmail, agentId, task } = claimed;
    const base = { browserRunId, userEmail };

    const started = await db
        .update(browserRun)
        .set({ status: "running", startedAt: new Date() })
        .where(and(eq(browserRun.id, browserRunId), eq(browserRun.status, "claimed"), eq(browserRun.claimedBy, workerId)))
        .returning({ id: browserRun.id });

    if (started.length === 0) {
        return { status: "failed", reason: "Run was not in the claimed state for this worker" };
    }

    await recordEventWithRetry({ ...base, kind: "started", actor: "system", actorId: workerId });

    const agentRows = await db
        .select({ name: AgentConfig.name })
        .from(AgentConfig)
        .where(and(eq(AgentConfig.agentId, agentId), eq(AgentConfig.userEmail, userEmail)));
    const agentName = agentRows[0]?.name ?? "Browser agent";

    const session = await openSessionForRun({ browserRunId, userEmail });
    if (!session.ok) {
        await recordEventWithRetry({ ...base, kind: "failed", actor: "system", actorId: workerId, detail: { reason: session.reason } });
        return { status: "failed", reason: session.message };
    }

    const { sessionRecordId, browserbaseSessionId } = session;
    await recordEventWithRetry({
        ...base, browserSessionId: sessionRecordId, kind: "session_created", actor: "system", actorId: workerId,
        detail: { browserbaseSessionId },
    });

    let outcome: WorkerOutcome;

    try {
        if (await cancellationRequested(browserRunId)) throw new RunCancelledError();

        const lease = await grantControl({ browserRunId, userEmail, holderKind: "agent", holderId: workerId });
        if (!lease) throw new Error("Could not take the agent control lease");

        await driver.setViewport(browserbaseSessionId, AGENT_VIEWPORT);

        const computer = new BrowserbaseComputer(
            { browserbaseSessionId, browserRunId, userEmail, agentId, sessionRecordId, workerId, generation: lease.generation },
            productionComputerDeps({
                browserRunId, userEmail, workerId,
                isCancelled: () => cancellationRequested(browserRunId),
                currentAgentGeneration: () => agentGenerationFor(browserRunId, userEmail, workerId),
            }),
        );

        const agent = new Agent({
            name: agentName,
            model: process.env.OPENAI_COMPUTER_MODEL || DEFAULT_COMPUTER_MODEL,
            instructions: instructionsFor(agentName, task),
            tools: [computerTool({ computer })],
        });

        const result = await runAgent(agent, task, { maxTurns: MAX_AGENT_TURNS });
        const finalOutput = typeof result.finalOutput === "string"
            ? result.finalOutput
            : JSON.stringify(result.finalOutput ?? "");

        if (await cancellationRequested(browserRunId)) throw new RunCancelledError();

        await recordEventWithRetry({
            ...base, browserSessionId: sessionRecordId, kind: "completed", actor: "agent", actorId: workerId,
            detail: { generation: computer.generation, resultLength: finalOutput.length },
        });
        outcome = { status: "completed", result: finalOutput };
    } catch (error) {
        if (error instanceof RunCancelledError) {
            outcome = { status: "cancelled" };
        } else {
            const reason = driver.redactCapabilities(error instanceof Error ? error.message : String(error));
            const kind = error instanceof HandoverTimeoutError ? "handover_timeout" : "worker_error";
            await recordEventWithRetry({
                ...base, browserSessionId: sessionRecordId, kind: "failed", actor: "system", actorId: workerId,
                detail: { reason: kind, message: reason.slice(0, 500) },
            });
            outcome = { status: "failed", reason };
        }
    } finally {
        await revokeControl({ browserRunId, userEmail }).catch(() => undefined);
        await driver.disconnectSession(browserbaseSessionId).catch(() => undefined);

        const released = await releaseSessionForRecord(sessionRecordId).catch(() => false);
        await recordEventWithRetry({
            ...base, browserSessionId: sessionRecordId, kind: "session_released", actor: "system", actorId: workerId,
            detail: { released },
        });
    }

    return outcome;
}

/** Persists the outcome and frees the slot. Safe to call twice. */
export async function finishBrowserRun(claimed: ClaimedBrowserRun, outcome: WorkerOutcome): Promise<void> {
    const endedAt = new Date();

    await db
        .update(browserRun)
        .set({
            status: outcome.status,
            endedAt,
            result: outcome.status === "completed" ? outcome.result : null,
            failureReason: outcome.status === "failed" ? outcome.reason : null,
        })
        .where(and(eq(browserRun.id, claimed.id), sql`${browserRun.status} IN ('claimed', 'running')`));

    await releaseBrowserSlot(claimed.id);
}
