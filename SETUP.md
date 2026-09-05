# Local setup

Setup notes for Arkitech AI. Written down because the install has one
non-obvious failure that costs time to rediscover.

## Install: `--legacy-peer-deps` is required

Plain `npm install` **fails** with an `ERESOLVE` error:

```
Conflicting peer dependency: @openai/agents@0.1.11
  peer @openai/agents@"^0.1.3" from @composio/openai-agents@0.10.1
```

This project pins `@openai/agents@^0.17.0`, but `@composio/openai-agents@0.10.1`
still declares a peer range of `^0.1.3`. Install with:

```bash
npm install --legacy-peer-deps
```

Use the flag on every install and every time you add a package, or npm will
fail again. `npx tsc --noEmit` passes cleanly afterwards, so the version skew
does not break types — but Composio tool invocation is the runtime surface to
watch if agent runs misbehave.

Verified on Node v22.22.2 / npm 10.9.7 (Node 20+ is the stated minimum).

## Environment variables

Copy the template, then fill it in:

```bash
cp .env.example .env
```

### Required — the app will not work without these

| Variable | Source | Consumed by |
| --- | --- | --- |
| `DATABASE_URL` | Neon → project → **pooled** connection string, keep `?sslmode=require` | `db/index.ts`, `drizzle.config.ts` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys | Clerk SDK (implicit) |
| `CLERK_SECRET_KEY` | Clerk dashboard → API Keys | `currentUser()` in every API route |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Literal `/sign-in` | Route at `app/sign-in/[[...sign-in]]` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Literal `/sign-up` | Route at `app/sign-up/[[...sign-up]]` |

`db/index.ts` falls back to `postgresql://placeholder-url` when `DATABASE_URL`
is unset, so a missing value surfaces as a connection error rather than a
clear configuration message.

Route protection lives in `proxy.ts` at the project root — Next.js 16 renamed
`middleware.ts` to `proxy.ts`, so look there, not for a middleware file.

### Required per feature

| Variable | Source | Gates |
| --- | --- | --- |
| `GOOGLE_CLOUD_GEMINI_API_KEY` | Google AI Studio | Agent *creation* — `app/api/agent/configure/route.ts` turns a prompt into a structured agent config |
| `OPENAI_API_KEY` | OpenAI dashboard | Agent *execution*. Never referenced in source; the `@openai/agents` SDK reads it from env |
| `OPENAI_MODEL` | Your choice; `gpt-4.1-mini` is the documented default | `lib/build-agent.ts`. Unset means the Agent is constructed with `model: undefined` |
| `COMPOSIO_API_KEY` | Composio dashboard | All external toolkit connections — `lib/composio.ts`, one session per agent |
| `BROWSERBASE_API_KEY` | Browserbase dashboard | The `browser_research` tool — `lib/browserbase-tool.ts` |
| `BROWSERBASE_AGENT_ID` | Browserbase → create an **agent**, copy its ID | Same tool. Separate from the API key and easy to miss |

### Optional locally

| Variable | Note |
| --- | --- |
| `INNGEST_EVENT_KEY` | Production only. Locally, `npx inngest-cli@latest dev` needs no keys |
| `INNGEST_SIGNING_KEY` | Same. Handler at `/api/inngest`, serving `ProcessScheduledAgent` (cron `*/15 * * * *`) and `ExecuteScheduledAgent` |
| `NEXT_PUBLIC_APP_URL` | **Unused** — no references anywhere in the codebase. Harmless to leave at its default |

## Run it

```bash
npm install --legacy-peer-deps
cp .env.example .env          # then fill in the values above
npm run db:push               # proves DATABASE_URL and creates the tables
npm run dev                   # http://localhost:3000
npx inngest-cli@latest dev    # separate terminal; only needed for scheduled runs
```

Minimum set for an end-to-end agent run: Neon + both Clerk keys + Gemini +
OpenAI. Composio and Browserbase gate individual tools, so they can be added
later without blocking first boot.

## Other useful commands

```bash
npm run db:generate   # generate migrations
npm run db:studio     # open Drizzle Studio
npx tsc --noEmit      # typecheck
```
