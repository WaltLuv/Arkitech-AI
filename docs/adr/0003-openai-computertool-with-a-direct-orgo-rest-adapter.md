# OpenAI computerTool driving Orgo through our own REST adapter

Computer-use Agents are driven by OpenAI's `computerTool` from the Agents SDK, executing against Orgo desktops through a small typed adapter we own. OpenAI is the agent brain, Orgo is the desktop runtime, and Arkitech owns everything in between.

The decision rests on what Arkitech must own, not on what any vendor does or does not currently support. Arkitech owns the run loop, approvals, the Control Lease, pause and takeover, screenshot and event capture, credits, and resumable state. Any design that hands the loop to a third party puts those concerns outside our control, and they are the product. The Agents SDK supports `computerTool`, approval interruptions, and resumable `RunState`, which is what the rest of Arkitech is already built on, so `standard` and `computer` Agents share one agent abstraction, one SDK, and one set of tool-wiring tests.

## Considered Options

Orgo's hosted agent endpoint, which runs its own computer loop. Rejected because intermediate tool calls and screenshots are not exposed through its streaming output, so approvals, pause, takeover, and audit history would all be built on top of a loop we cannot see into.

Orgo's MCP server, which exposes the API as a tool surface. Rejected as the runtime control layer for a related reason: it offers capabilities to a model, where we need a typed client our own code drives, so that the control lease and approval gate are enforced rather than suggested. It remains a useful reference implementation and fixture source.

Orgo's native Anthropic provider. Rejected for v1 because it would introduce a second agent runtime: a different provider, a likely separate service path, different conversation and resume behaviour, harder integration with existing Composio tools, and less control over credits, approvals, pause, takeover, and audit events. It may be used as an isolated diagnostic spike to prove a desktop works, never in the production path. Adopting it would be a new decision, recorded here.

## Consequences

The adapter targets the REST contract this project has verified, using the OpenAPI snapshot Orgo publishes inside `orgo-mcp-server`. What SDKs, providers, or model integrations Orgo offers later does not change the decision: Arkitech owns the loop either way, and the adapter is small enough to re-target if a better contract appears.

Two behaviours in that contract are constraints the adapter must encode rather than edge cases: a screenshot returns a URL that must be fetched separately for bytes, and there is no double-click endpoint (it is a click with a flag).

The desktop-driving model is configured separately as `COMPUTER_USE_MODEL`. The standard agent model is not assumed to support computer use.

Model compatibility is an open risk closed only by a live smoke test proving screenshot to action to screenshot against a real desktop. That test is a release gate. It cannot run in the environment this decision was made in, where `orgo.ai` and `platform.openai.com` are egress-blocked, so the adapter is built against recorded fixtures and the live run happens elsewhere.

Orgo is infrastructure, configured under a Computer or Infrastructure setting. It is never a Composio OAuth integration and never appears in the Integrations page beside the user's own connected accounts.
