# OpenAI computerTool driving Orgo through our own REST adapter

Computer-use Agents are driven by OpenAI's `computerTool` from the Agents SDK, executing against Orgo desktops through a small typed adapter we own, written directly against Orgo's HTTP API. We keep the run loop rather than delegating it, because approvals, the Control Lease, event capture, pause, and human takeover all have to happen between turns.

This is deliberately the less-trodden path. Orgo's own published SDK ships exactly two providers, `orgo` and `anthropic`, both targeting Claude with Anthropic's computer-use tool, and no Orgo artifact we could reach mentions OpenAI at all. We chose OpenAI anyway so that `standard` and `computer` Agents share one agent abstraction, one SDK, and one set of tool-wiring tests.

## Considered Options

Orgo's MCP server, which exposes all 43 API operations as tools, regenerates itself from Orgo's spec so it cannot drift, and returns screenshots as images a model can see. Rejected as the runtime control layer because it is a tool surface for a model, not a typed client our code drives; the control lease and approval gate must be enforced by us, not offered to the model as options. It remains the reference implementation and fixture source.

Orgo's native Anthropic provider, which is the supported path. Rejected for now because it would mean two agent abstractions in one product. If the OpenAI spike fails, switching is a new decision to be recorded here, not a silent fallback.

## Consequences

There is no Orgo TypeScript SDK; the official one is Python. The adapter is therefore hand-written against the REST contract, using the OpenAPI snapshot that Orgo ships inside `orgo-mcp-server` as the source of truth for request and response shapes.

Two Orgo behaviours are constraints the adapter must encode, not edge cases: a screenshot returns a URL that must be fetched separately to get bytes, and there is no double-click endpoint (it is a click with a flag).

Model compatibility is an open risk, closed only by a live smoke test proving screenshot to action to screenshot against a real desktop. That test is a release gate. It cannot run in the environment this decision was made in, where `orgo.ai` and `platform.openai.com` are both egress-blocked, so the adapter is built and tested against recorded fixtures and the live run happens elsewhere.

Orgo is infrastructure, configured under a Computer or Infrastructure setting. It is never a Composio OAuth integration and never appears in the Integrations page beside the user's own connected accounts.
