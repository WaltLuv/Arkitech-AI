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
