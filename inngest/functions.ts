/**
 * Background jobs that queue due scheduled runs and execute agents at their scheduled time.
 */
import type { CreatedAgentType } from "@/components/custom/agents/CreateAgent";
import { AgentConfig, AgentRun, db } from "@/db";
import { calculateNextDailyRun } from "@/lib/agent-schedule";
import { chargeRun, refundRun } from "@/lib/credits";
import { executeAgent } from "@/lib/execute-agent";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { inngest } from "./client";

export const ProcessScheduledAgent = inngest.createFunction(
    {
        id: "process-scheduled-agent-runs",
        // Run this scheduler every 5 minutes to pick pending agent jobs.
        triggers: [{ cron: "*/15 * * * *" }],
    },
    async ({ step }) => {
        const now = new Date();
        const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

        // Step 1: Load scheduled agent runs whose execution time is in the next 60 minutes.
        const dueRuns = await step.run("load-due-agent-runs", async () => {
            return await db
                .select({
                    run: AgentRun,
                })
                .from(AgentRun)
                .where(
                    and(
                        eq(AgentRun.status, "scheduled"),
                        gte(AgentRun.scheduledFor, now),
                        lte(AgentRun.scheduledFor, nextHour),
                    ),
                )
                .orderBy(asc(AgentRun.scheduledFor))
                .limit(100);
        });

        const results = [];

        for (const { run } of dueRuns) {
            // Step 2: Atomically claim this scheduled run as queued.
            const queuedRun = await step.run(`queue-agent-run-${run.id}`, async () => {
                const result = await db
                    .update(AgentRun)
                    .set({
                        status: "queued",
                        queuedAt: now,
                    })
                    .where(
                        and(
                            eq(AgentRun.id, run.id),
                            eq(AgentRun.status, "scheduled"),
                        ),
                    )
                    .returning();

                return result[0] ?? null;
            });

            // Step 3: If another cron already queued it, skip sending another event.
            if (!queuedRun) {
                results.push({
                    runId: run.id,
                    agentId: run.agentId,
                    status: "skipped",
                });
                continue;
            }

            // Step 4: Send a separate event so execution runs outside the cron job.
            await step.sendEvent(`send-execute-agent-event-${run.id}`, {
                name: "agent/run.execute",
                data: {
                    runId: run.id,
                },
            });

            // Step 5: Track the queued event for the cron execution summary.
            results.push({
                runId: run.id,
                agentId: run.agentId,
                status: "queued",
            });
        }

        // Step 6: Return a compact summary for Inngest logs and observability.
        return {
            queued: results.filter((result) => result.status === "queued").length,
            results,
        };
    },
);

export const ExecuteScheduledAgent = inngest.createFunction(
    {
        id: "execute-scheduled-agent-run",
        // Run one queued agent execution whenever the cron function emits this event.
        triggers: [{ event: "agent/run.execute" }],
    },
    async ({ event, step }) => {
        const runId = event.data.runId as string | undefined;

        if (!runId) {
            throw new Error("Missing runId for scheduled agent execution.");
        }

        // Step 1: Load the queued run and its agent configuration.
        const runData = await step.run(`load-agent-run-${runId}`, async () => {
            const result = await db
                .select({
                    run: AgentRun,
                    agentConfig: AgentConfig,
                })
                .from(AgentRun)
                .innerJoin(
                    AgentConfig,
                    eq(AgentRun.agentId, AgentConfig.agentId),
                )
                .where(eq(AgentRun.id, runId))
                .limit(1);

            return result[0] ?? null;
        });

        if (!runData) {
            throw new Error(`Agent run ${runId} was not found.`);
        }

        const { run, agentConfig } = runData;

        try {
            // Step 2: Wait until this run's exact scheduled execution time.
            await step.sleepUntil(
                `wait-for-scheduled-time-${run.id}`,
                run.scheduledFor,
            );

            // Step 3: Mark this queued run as running before executing the agent.
            const startedRun = await step.run(
                `mark-run-started-${run.id}`,
                async () => {
                    const result = await db
                        .update(AgentRun)
                        .set({
                            status: "running",
                            startedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(AgentRun.id, run.id),
                                eq(AgentRun.status, "queued"),
                            ),
                        )
                        .returning();

                    return result[0] ?? null;
                },
            );

            // Step 4: If the run is no longer queued, another execution handled it.
            if (!startedRun) {
                return {
                    runId: run.id,
                    agentId: run.agentId,
                    status: "skipped",
                };
            }

            // Step 5: Charge this execution against the Run, so the ledger can
            // attribute the spend. Safe to retry: the idempotency key collapses a
            // repeated step into one debit.
            const creditBalance = await step.run(
                `deduct-credit-${run.id}`,
                async () => chargeRun({
                    userEmail: run.userEmail,
                    agentId: run.agentId,
                    runId: run.id,
                    cost: run.creditCost,
                }),
            );

            if (!creditBalance) {
                await step.run(`mark-run-no-credits-${run.id}`, async () => {
                    await db
                        .update(AgentRun)
                        .set({
                            status: "failed",
                            error: "Insufficient credit balance.",
                            completedAt: new Date(),
                        })
                        .where(eq(AgentRun.id, run.id));
                });

                return {
                    runId: run.id,
                    agentId: run.agentId,
                    status: "failed",
                    error: "Insufficient credit balance.",
                };
            }

            // Step 6: Execute the agent using the existing project agent runner.
            const output = await step.run(`execute-agent-${run.id}`, async () => {
                const scheduledExecutionInstruction = `
This run was triggered by Arkitech AI's scheduler.
Do not create, schedule, repeat, automate, or ask how to schedule this task.
Execute only the underlying task for this single scheduled occurrence now.
If the objective mentions daily, recurring, schedule, or a time, treat that only as context for why this run exists.
`.trim();

                // Normalize nullable DB fields into the stricter UI agent config type.
                const executableAgentConfig: CreatedAgentType = {
                    id: agentConfig.id,
                    userEmail: agentConfig.userEmail ?? run.userEmail,
                    agentId: agentConfig.agentId,
                    name: agentConfig.name ?? "",
                    agentImage: agentConfig.agentImage ?? "",
                    description: agentConfig.description ?? "",
                    instructions: [
                        agentConfig.instructions ?? "",
                        scheduledExecutionInstruction,
                    ]
                        .filter(Boolean)
                        .join("\n\n"),
                    objective: agentConfig.objective ?? "",
                    tools: agentConfig.tools,
                    skills: Array.isArray(agentConfig.skills)
                        ? (agentConfig.skills as string[])
                        : [],
                    schedule: (agentConfig.schedule ?? {
                        type: "manual",
                    }) as CreatedAgentType["schedule"],
                    outputFormat: agentConfig.outputFormat ?? "",
                    status: agentConfig.status ?? "active",
                    createdAt: String(agentConfig.createdAt),
                    composioSessionId:
                        agentConfig.composioSessionId ?? undefined,
                };

                return await executeAgent({
                    agentConfig: executableAgentConfig,
                    userEmail: run.userEmail,
                    input: [
                        scheduledExecutionInstruction,
                        "",
                        "Task to execute now:",
                        executableAgentConfig.objective,
                    ].join("\n"),
                });
            });

            // Step 7: Persist the successful output back to the AgentRun row.
            await step.run(`mark-run-completed-${run.id}`, async () => {
                await db
                    .update(AgentRun)
                    .set({
                        status: "completed",
                        output,
                        completedAt: new Date(),
                    })
                    .where(eq(AgentRun.id, run.id));
            });

            const schedule = agentConfig.schedule as {
                type?: string;
                frequency?: string;
                time?: string;
                timezone?: string;
            } | null;

            // Step 8: For daily recurring agents, create the next scheduled run.
            if (
                schedule?.type === "recurring" &&
                schedule.frequency === "daily" &&
                schedule.time
            ) {
                await step.run(`schedule-next-run-${run.id}`, async () => {
                    // Avoid creating a duplicate future run if the agent was edited while executing.
                    const existingScheduledRun = await db
                        .select({ id: AgentRun.id })
                        .from(AgentRun)
                        .where(
                            and(
                                eq(AgentRun.agentId, run.agentId),
                                eq(AgentRun.status, "scheduled"),
                            ),
                        )
                        .limit(1);

                    if (existingScheduledRun.length > 0) {
                        return;
                    }

                    const timezone = schedule.timezone ?? run.timezone ?? "UTC";

                    const nextRun = calculateNextDailyRun({
                        time: schedule.time!,
                        timezone,
                        after: new Date(run.scheduledFor),
                    });

                    await db
                        .insert(AgentRun)
                        .values({
                            agentId: run.agentId,
                            userEmail: run.userEmail,
                            scheduledFor: nextRun,
                            timezone,
                            status: "scheduled",
                        })
                        .onConflictDoNothing();
                });
            }

            // Step 9: Return the single-run execution summary.
            return {
                runId: run.id,
                agentId: run.agentId,
                status: "completed",
            };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown error";

            // Step 10a: Refund. This path previously charged and never gave the
            // credit back, so the same failure cost a credit when scheduled and
            // nothing when run on demand. Issued at most once per Run.
            await step.run(`refund-run-${run.id}`, async () => {
                await refundRun({
                    userEmail: run.userEmail,
                    agentId: run.agentId,
                    runId: run.id,
                    cost: run.creditCost,
                    reason: "worker_failure",
                });
            });

            // Step 10: Persist failures so the run does not stay stuck as queued/running.
            await step.run(`mark-run-failed-${run.id}`, async () => {
                await db
                    .update(AgentRun)
                    .set({
                        status: "failed",
                        error: message,
                        completedAt: new Date(),
                    })
                    .where(eq(AgentRun.id, run.id));
            });

            // Step 11: Return failure details for the Inngest execution summary.
            return {
                runId: run.id,
                agentId: run.agentId,
                status: "failed",
                error: message,
            };
        }
    },
);

// Keep the existing API route import working while using the clearer function name above.
export const processTask = ProcessScheduledAgent;
