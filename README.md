# Arkitech AI

Arkitech AI is a Next.js app for creating, editing, scheduling, and running AI agents. It uses Clerk for auth, Neon Postgres with Drizzle for persistence, Gemini for agent configuration generation, OpenAI Agents for execution, Composio for connected tools, Browserbase for read-only live browsing, and Inngest for scheduled/background runs.

## Tech Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS and shadcn-style UI components
- Clerk authentication
- Neon Serverless Postgres and Drizzle ORM
- Google Gemini structured output
- OpenAI Agents SDK
- Composio tool sessions
- Browserbase browser agents
- Inngest scheduled jobs

## Prerequisites

- Node.js 20 or newer
- npm
- Accounts/API keys for Clerk, Neon, Google AI Studio or Google Cloud Gemini, OpenAI, Composio, Browserbase, and Inngest

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file:

```bash
cp .env.example .env
```

3. Fill in the values in `.env`.

4. Push the database schema to Neon:

```bash
npm run db:push
```

5. Start the Next.js app:

```bash
npm run dev
```

6. Open the app:

```text
http://localhost:3000
```

## Environment Variables

### App

`NEXT_PUBLIC_APP_URL`

Base URL for the local or deployed app. Use `http://localhost:3000` in development.

### Database

`DATABASE_URL`

Create a Neon project, open the connection details, choose the pooled Postgres connection string, and paste it here. Keep `sslmode=require`.

### Clerk

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

`CLERK_SECRET_KEY`

`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`

`NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`

Create a Clerk application, then copy the publishable key and secret key from the Clerk dashboard. Add `http://localhost:3000` to the allowed development origins if Clerk prompts for it.

### Gemini

`GOOGLE_CLOUD_GEMINI_API_KEY`

Create an API key in Google AI Studio or Google Cloud. This app uses Gemini to convert a user prompt into a structured agent configuration.

### OpenAI

`OPENAI_API_KEY`

`OPENAI_MODEL`

Create an OpenAI API key and choose the model used by the Agents SDK. A good development default is `gpt-4.1-mini`; use a stronger model if your agents need better reasoning.

### Composio

`COMPOSIO_API_KEY`

Create a Composio API key from your Composio dashboard. The app creates one Composio session per agent and uses it to connect external toolkits.

### Browserbase

`BROWSERBASE_API_KEY`

`BROWSERBASE_AGENT_ID`

Create a Browserbase API key and Browserbase agent. The app uses this for read-only web research through the `browser_research` tool.

### Inngest

`INNGEST_EVENT_KEY`

`INNGEST_SIGNING_KEY`

These are required for production Inngest event delivery and verification. For local development, you can run the Inngest dev server:

```bash
npx inngest-cli@latest dev
```

The Inngest handler is available at:

```text
http://localhost:3000/api/inngest
```

## Database Commands

Generate migrations:

```bash
npm run db:generate
```

Push the current schema directly:

```bash
npm run db:push
```

Open Drizzle Studio:

```bash
npm run db:studio
```

## Main Workflows

- Create an agent from a prompt on the dashboard.
- Answer clarification questions if Gemini needs more information.
- Edit the saved agent instructions, skills, schedule, status, and connected tools.
- Run an agent manually or chat with it from the drawer.
- Schedule recurring daily agents; Inngest queues due runs and executes them at the scheduled time.
- Review results and errors from the run history page.

## Project Structure

- `app/` - Next.js app routes, pages, layouts, and API handlers
- `components/custom/` - app-specific dashboard, agent, and run-history components
- `components/ui/` - reusable UI primitives
- `db/` - Drizzle client and schema definitions
- `data/` - Gemini prompts and response schemas
- `inngest/` - scheduled/background job client and functions
- `lib/` - agent execution, scheduling, credits, Composio, Browserbase, and shared utilities

## Troubleshooting

- If sign-in fails, verify both Clerk keys and the sign-in/sign-up URLs.
- If database calls fail, confirm `DATABASE_URL` is the pooled Neon connection string and run `npm run db:push`.
- If agent creation fails, verify `GOOGLE_CLOUD_GEMINI_API_KEY`.
- If agent execution fails, verify `OPENAI_API_KEY`, `OPENAI_MODEL`, and selected tool connections.
- If external tools do not connect, verify `COMPOSIO_API_KEY` and reconnect the toolkit from the agent edit sheet.
- If live browsing fails, verify `BROWSERBASE_API_KEY` and `BROWSERBASE_AGENT_ID`.
- If scheduled runs do not execute locally, run both `npm run dev` and `npx inngest-cli@latest dev`.
