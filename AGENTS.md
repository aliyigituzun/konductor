# AGENTS.md

## Project overview

Konductor is a Bun/TypeScript monorepo for overseeing agent-assisted software
delivery. It includes a CLI, durable project and host state, adapter-driven agent
orchestration, MCP integration, telemetry ingestion, and a React/Vite dashboard.

## Repository layout

- `apps/web`: React/Vite dashboard
- `packages/schema`: shared Zod schemas and domain types
- `packages/store`: persistence and project state
- `packages/agents`: agent invocation, transports, worktrees, and run status
- `packages/api`: API routes and host-facing operations
- `packages/host`: host daemon
- `packages/cli`: `konductor` CLI commands
- `packages/telemetry`: OpenTelemetry ingestion and adapters
- `.konductor/`: generated project runtime state; do not treat it as source code

## Before making changes

Read `CLAUDE.md` first, then consult the documents relevant to the task.
`IMPLEMENTATION.md` is the primary source of truth for current work. The focused
supporting documents are `CLI_IMPLEMENTATION.md`, `DESIGN.md`, `STORAGE.md`, and
`USAGE.md`; source schemas in `packages/schema` are the authoritative contracts.

Preserve unrelated user changes in the working tree. Inspect existing patterns before introducing new abstractions, and keep changes within the requested scope.

## Development commands

Run from the repository root:

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Individual packages generally support `bun run typecheck`; packages with tests support `bun run test`. The web app can be run with `bun run --cwd apps/web dev`.

## Engineering conventions

- Use TypeScript and existing workspace package boundaries.
- Put shared contracts in `@konductor/schema`; avoid duplicating domain shapes in consumers.
- Preserve the established persistence boundary unless the task explicitly changes it.
- Preserve compatibility normalization for existing config and snapshot formats.
- Keep CLI output and dashboard behavior aligned with the documented usage flow.
- Dashboard copy is for operators: never surface developer-side explanations
  (implementation notes, ordering rules, rationale) as UI text. Put those in code
  comments or the docs instead.
- Add or update focused tests for behavior changes, especially in store, API, agent, and CLI packages.
- Avoid committing generated runtime state, credentials, logs, or machine-specific paths.

## Product principles

Progress is derived from phase/item rollups rather than telemetry. Preserve explicit
project ownership and documented storage boundaries. Interactive browser terminals,
queueing, and DAG scheduling remain out of scope unless a task explicitly adds them.

## Verification

For code changes, run the narrowest relevant package checks first, then the root `typecheck`, `test`, and `build` commands when practical. Report any checks that could not run and why.
