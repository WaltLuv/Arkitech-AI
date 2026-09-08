# Channels are a shared conversation layer, not two integrations

Arkitech had no inbound messaging. Slack existed only as an outbound Composio toolkit an Agent could call as a tool, chat history lived in React state in the drawer and was replayed to the server on every turn, and there was no table anywhere for a conversation, a message, or an external identity. Telegram and Slack were both wanted as places a person can talk to their Team member, so the choice was whether to build two integrations or one layer with two adapters. We built the layer: an Arkitech-owned conversation, message, connection and thread model, with a single inbound pipeline, and provider knowledge confined to an adapter and a parser on each side.

## Considered Options

Two independent integrations, each owning its own storage and routing. Rejected because the second one is where the divergence starts, and the first thing to diverge is charging. A channel that builds its own execution path stops sharing the Run, and spend that cannot be attributed to an Agent cannot appear on the usage dashboard.

Generalising the existing Composio Slack connection to serve inbound as well. Rejected because it is the wrong direction of travel. Composio holds outbound tool credentials on Arkitech's behalf; inbound needs a workspace install, an app-level signing secret, and an events endpoint Slack calls, none of which Composio's connection model expresses. The two coexist and are separate capabilities: an Agent using Slack as a tool, and a person messaging their Team member from Slack.

One universal thread per Team member across every channel. Rejected on the product side. Merging a Slack DM and a Telegram chat into a single transcript reads as a bug to the person in either app, who can see only half of it. Conversations are per-channel, and continuity comes from every conversation resolving to the same owner and Team member, so Arkitech can present them together without pretending they were one exchange.

## Consequences

The pipeline order is the security model, and it is identical for both providers: verified request, connection, deduplication, authorised identity, Team member, conversation, persist, hand off. No Agent is built until every step has passed, so finding a bot's public username gets a stranger as far as the authorisation check and no further.

Authorisation is a stored fact, not an inference. A bot username is public and anyone can message it, so a `channelThread` row is what says this external chat was linked by someone holding the account. Telegram earns that row with a single-use code carried in a deep link. Slack earns it from the OAuth install itself, which is performed from inside the workspace by a signed-in Arkitech user, so there is nothing further to prove.

A Slack connection is keyed by workspace and installing user together, not by workspace alone. Two Arkitech customers can work in the same Slack workspace, and keying on the workspace would have the second install collide with the first or inherit it.

Both webhooks acknowledge and then work. Slack retries any event it does not get a 200 for within three seconds, up to three times, and Telegram re-delivers an update whose webhook was slow; an Agent turn is far longer than that. The turn runs in an Inngest function, and answering first is what makes the dedup claim mean anything.

Deduplication is a unique-index insert rather than a check. Two retries can arrive concurrently and a read-then-write lets both through, and the neon-http driver has no transactions to close that window. This is the shape the Credit Ledger already uses for its idempotency key.

Channels are not a privileged path. A message from Telegram reaches the Agent through the same `runAgentTurn`, so it creates the same Run, spends the same Usage Credit, is refunded the same way on failure, and is bound by the same tool permissions and browser site policy as the same words typed into Arkitech.

Web chat moved onto the same store, which is a behaviour change and not only a refactor: the client now sends one message rather than a history it composed, and a client can no longer present a past that never happened.

Credentials are sealed with AES-256-GCM before storage, and `CHANNEL_SECRET_KEY` therefore joins the set of values that cannot be rotated casually: changing it makes every stored connection unopenable and each one has to be reconnected.

Attachments are deliberately not supported. Arkitech's conversation system has no file handling to attach them to, and claiming a message type that does not work end to end is worse than declining it, so a photo or a document is answered with a plain-language note asking for text.
