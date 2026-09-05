# Arkitech AI

A Next.js app for creating, editing, scheduling, and running AI agents. See `README.md` for the stack and `SETUP.md` for local setup.

## Agent skills

Per-repo configuration for Matt Pocock's engineering skills. Seeded by `/setup-matt-pocock-skills`; edit these files directly rather than re-running the skill, unless you want to switch issue trackers.

### Issue tracker

Issues live as GitHub issues on `WaltLuv/Arkitech-AI`, driven through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root and ADRs under `docs/adr/`, both created lazily by `/domain-modeling` when a term or decision actually needs recording. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
