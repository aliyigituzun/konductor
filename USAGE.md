# Konductor Usage Guide

## Goal

Konductor now supports a local Claude Code host in addition to status, decisions, and telemetry tracking. The main loop is:

1. initialize a repo
2. start the local host daemon
3. launch Claude from the dashboard or CLI
4. let Claude write updates and status through Konductor MCP
5. inspect runs, terminal output, files, and telemetry in the dashboard or terminal

## Typical Flow

### 1. Initialize A Project

```bash
konductor init
```

This now creates:

- `konductor.config.json`
- `.konductor/`
- `.mcp.json`
- `.claude/settings.local.json` OTEL env defaults
- `~/.konductor/registry.json` registration entry

Important repo-local files:

```text
.konductor/status/current.json
.konductor/updates.jsonl
.konductor/telemetry/latest.json
.konductor/history/
.konductor/runs/
```

Important home-directory files:

```text
~/.konductor/registry.json
~/.konductor/host/
```

### 2. Start The Local Claude Host

```bash
konductor host start
```

Use this to verify the daemon:

```bash
konductor host status
```

Stop it when needed:

```bash
konductor host stop
```

### 3. Let Claude Use Konductor MCP

Konductor now seeds `.mcp.json` so project-scoped Claude sessions can discover the `konductor mcp serve` server automatically.

You can still run the MCP server manually for debugging:

```bash
konductor mcp serve
```

The MCP server now exposes:

- `get_status_schema`
- `get_current_status`
- `get_project_context`
- `get_run_context`
- `write_update`
- `write_status`

Dashboard-launched Claude runs pass `run_id`, `profile_id`, `feature_item_id`, and `source` into MCP so updates and status writes are traceable.

### 4. Launch Claude Runs

From the CLI:

```bash
konductor run start --prompt "Review the current blockers and propose the next code changes"
```

Optional flags:

```bash
--profile <id>
--packs <pack-a,pack-b>
--feature <feature-item-id>
```

Inspect and control runs:

```bash
konductor run list
konductor run show <run-id>
konductor run logs <run-id>
konductor run stop <run-id>
```

From the dashboard:

- `Features` tab
  - add a new feature or create a new feature category
  - newly added features are saved with `status: "todo"`
  - host status is shown inline before feature-scoped launches
  - select one feature item
  - choose prompt packs
  - enter a prompt
  - click `Start agent`
  - launch feedback now explains whether the request was sent, whether the host is down, and what file/log path to inspect next
- `Agents` tab
  - review prompt packs and profiles
  - launch Claude directly with a free-form prompt
  - inspect running agents
  - inspect past agent tasks
  - inspect host status and launch diagnostics before sending work
  - view the read-only terminal panel

### 5. Refresh Local Snapshots

```bash
konductor sync
```

This writes a local history snapshot, refreshes registry metadata, and keeps the latest telemetry/status pointers current for the dashboard.

### 6. Inspect The Project In Terminal

```bash
konductor status
konductor issues
konductor stats
konductor doctor
```

`konductor doctor` now also checks:

- default Claude binary resolution
- `.mcp.json` presence
- host daemon reachability
- host storage directories

### 7. Open The Dashboard

```bash
konductor dashboard
```

Current dashboard surfaces:

- `Portfolio`
  - project state
  - blockers
  - dependencies
  - active agent count
  - token usage
  - direct `info` link per project
- `Status`
  - status summary
  - updates feed
  - phase board
  - blockers
  - token and activity panels
- `Features`
  - feature cards
  - single-item selection
  - feature-scoped Claude launch
- `Agents`
  - prompt packs
  - Claude profiles
  - running agents
  - past agent tasks
  - host status callout with recovery hint if the daemon is down
  - read-only terminal panel with command, env summary, and stdout/stderr
- `Project Details`
  - markdown docs in the repo root

## Defaults

- Claude Code is the only supported runner in this implementation.
- The host is local-only.
- Prompt packs are Konductor-managed prompt bundles, not native Claude skills.
- The dashboard terminal is read-only.
- Feature launches are single-item only.
- Local files remain the source of truth.

## Important Documents

- [IMPLEMENTATION.md](./IMPLEMENTATION.md)
- [STATUS_SCHEMA.md](./STATUS_SCHEMA.md)
- [CLI_IMPLEMENTATION.md](./CLI_IMPLEMENTATION.md)
- [TDD.md](./TDD.md)
- [DESIGN.md](./DESIGN.md)
