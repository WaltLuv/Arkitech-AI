/**
 * The only shape a channel connection is allowed to take on its way to a
 * client.
 *
 * Built by naming what goes out rather than by deleting what must not, because
 * a deny-list silently starts leaking the day someone adds a column. The
 * sealed credential envelope has no accessor here at all.
 *
 * The words are the ones a customer would use. No provider status codes, no
 * webhook state, no ids they have no use for.
 */
import type { ChannelConnection } from "@/db";

export type ConnectionView = {
    id: string;
    provider: "telegram" | "slack";
    /** connected | finish_connecting | needs_attention | not_connected */
    state: "connected" | "finish_connecting" | "needs_attention" | "not_connected";
    /** @SomeBot, or a Slack workspace name. Safe to show. */
    accountLabel: string | null;
    /** Which Team member answers here. */
    agentId: string | null;
    updatedAt: string;
    /** Plain-language reason, present only when something needs attention. */
    attention: string | null;
};

const STATE_BY_STATUS: Record<string, ConnectionView["state"]> = {
    active: "connected",
    pending_link: "finish_connecting",
    needs_attention: "needs_attention",
    disconnected: "not_connected",
};

export function toConnectionView(connection: ChannelConnection): ConnectionView {
    return {
        id: connection.id,
        provider: connection.provider as ConnectionView["provider"],
        state: STATE_BY_STATUS[connection.status] ?? "needs_attention",
        accountLabel: connection.externalAccountLabel,
        agentId: connection.defaultAgentId,
        updatedAt: connection.updatedAt.toISOString(),
        attention: connection.status === "needs_attention" ? connection.statusReason : null,
    };
}
