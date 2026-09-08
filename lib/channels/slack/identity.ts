/**
 * How a Slack connection is identified.
 *
 * Not by workspace alone. A Slack app is installed per workspace, but two
 * Arkitech customers can work in the same one, and keying on the workspace
 * would make the second install collide with the first, or worse, inherit it.
 * The pair of workspace and installing user is what actually names one
 * customer's connection.
 *
 * Inbound events carry both, so the same key reconstructs from an event.
 */
export function slackAccountKey(teamId: string, userId: string): string {
    return `${teamId}:${userId}`;
}

/** The workspace half, for display and diagnostics. */
export function slackTeamId(accountKey: string): string {
    return accountKey.split(":")[0] ?? accountKey;
}
