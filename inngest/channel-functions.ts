/**
 * Background work for inbound channel messages.
 *
 * The webhook routes answer their provider immediately and enqueue this. That
 * split is not an optimisation: Slack retries any event it does not get a 200
 * for within three seconds, and Telegram re-delivers an update whose webhook
 * was slow, so running an Agent turn inside the request would turn one message
 * into four. Answering first and working here is what makes the dedup claim
 * hold.
 */
import { channelConnection, conversation, db, message } from "@/db";
import { inngest } from "@/inngest/client";
import { loadOwnedAgent, runAgentTurn } from "@/lib/agent-turn";
import {
    buildAgentInput,
    loadConversationMessages,
    updateMessageDelivery,
} from "@/lib/channels/conversations";
import { deliverReply } from "@/lib/channels/outbound";
import { sweepInboundEvents } from "@/lib/channels/dedup";
import { eq } from "drizzle-orm";

/** Shown when the account has run out of Usage Credits. */
const OUT_OF_CREDIT_REPLY =
    "You're out of usage credits, so I couldn't run that. Top up in Arkitech and send it again.";

/** Shown when the Team member itself failed. The Run is refunded either way. */
const AGENT_FAILED_REPLY =
    "Something went wrong while I was working on that. Nothing was charged. Please try again.";

/** Shown when the connection no longer has a Team member to answer with. */
const NO_AGENT_REPLY =
    "No team member is assigned to this connection yet. Open Arkitech, go to Settings, Connections, and choose one.";

export const RespondToChannelMessage = inngest.createFunction(
    {
        id: "respond-to-channel-message",
        triggers: [{ event: "channel/message.received" }],
        // One turn per inbound message. Retrying the whole function would run
        // the Agent again and charge again, and the message is already
        // deduplicated at the door, so a failure here is reported rather than
        // repeated.
        retries: 0,
    },
    async ({ event, step }) => {
        const messageId = event.data.messageId as string | undefined;
        const conversationId = event.data.conversationId as string | undefined;

        if (!messageId || !conversationId) {
            throw new Error("channel/message.received is missing its message");
        }

        // Loaded outside step.run deliberately. A step's return value is
        // serialised to JSON and replayed, which turns every timestamp into a
        // string and hands the adapter a connection that only looks like one.
        // Side effects below still get their own step; this is just a read.
        const rows = await db
            .select({ conversation, connection: channelConnection, inbound: message })
            .from(message)
            .innerJoin(conversation, eq(message.conversationId, conversation.id))
            .innerJoin(channelConnection, eq(conversation.connectionId, channelConnection.id))
            .where(eq(message.id, messageId))
            .limit(1);

        const context = rows[0] ?? null;

        if (!context) {
            // The conversation or its connection was removed between the
            // webhook and here. Nothing to answer, and nobody to answer to.
            return { outcome: "gone" };
        }

        const { conversation: thread, connection, inbound } = context;

        if (connection.status === "disconnected") {
            return { outcome: "disconnected" };
        }

        const agentConfig = await loadOwnedAgent(thread.agentId, thread.userEmail);

        if (!agentConfig) {
            await step.run("reply-no-agent", () =>
                deliverReply({
                    connection,
                    conversationId: thread.id,
                    userEmail: thread.userEmail,
                    text: NO_AGENT_REPLY,
                    replyToId: inbound.id,
                    replyToExternalMessageId: inbound.externalMessageId,
                }),
            );

            return { outcome: "no_agent" };
        }

        // History comes from Arkitech's own store rather than from the
        // provider, so the Team member sees the same conversation whichever
        // app the person is using.
        const history = await loadConversationMessages({
            conversationId: thread.id,
            userEmail: thread.userEmail,
        });

        // Not wrapped in step.run: an Agent turn charges a Usage Credit, and a
        // replayed step would charge a second one.
        const turn = await runAgentTurn({
            agentConfig,
            userEmail: thread.userEmail,
            input: buildAgentInput(history),
        });

        if (turn.outcome === "insufficient_credit") {
            await step.run("reply-out-of-credit", () =>
                deliverReply({
                    connection,
                    conversationId: thread.id,
                    userEmail: thread.userEmail,
                    text: OUT_OF_CREDIT_REPLY,
                    replyToId: inbound.id,
                    replyToExternalMessageId: inbound.externalMessageId,
                }),
            );

            return { outcome: "insufficient_credit" };
        }

        if (turn.outcome === "failed" || turn.outcome === "agent_not_found") {
            await step.run("reply-agent-failed", () =>
                deliverReply({
                    connection,
                    conversationId: thread.id,
                    userEmail: thread.userEmail,
                    text: AGENT_FAILED_REPLY,
                    runId: turn.outcome === "failed" ? turn.runId : null,
                    replyToId: inbound.id,
                    replyToExternalMessageId: inbound.externalMessageId,
                }),
            );

            return { outcome: "agent_failed" };
        }

        const answer = turn.output?.trim();

        if (!answer) {
            await step.run("mark-empty-answer", () =>
                updateMessageDelivery({ messageId: inbound.id, status: "failed", error: "Empty answer" }),
            );

            return { outcome: "empty_answer", runId: turn.runId };
        }

        const delivered = await step.run("deliver-reply", () =>
            deliverReply({
                connection,
                conversationId: thread.id,
                userEmail: thread.userEmail,
                text: answer,
                runId: turn.runId,
                replyToId: inbound.id,
                replyToExternalMessageId: inbound.externalMessageId,
            }),
        );

        return { outcome: delivered.outcome, runId: turn.runId };
    },
);

/**
 * Drops dedup claims old enough that no provider would still retry them.
 * Without it the table grows for the life of the install.
 */
export const SweepChannelInboundEvents = inngest.createFunction(
    {
        id: "sweep-channel-inbound-events",
        triggers: [{ cron: "17 4 * * *" }],
    },
    async () => {
        await sweepInboundEvents();
        return { outcome: "swept" };
    },
);
