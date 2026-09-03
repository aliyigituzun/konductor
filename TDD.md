# Konductor Technical Design Document

## Product Summary

Konductor is a local-first oversight layer for agent-assisted software delivery. It now covers both:

- structured project reporting
- local Claude Code orchestration

The current product shape is:

- Bun CLI
- local file-backed status and history
- Claude Code MCP bridge
- Claude host daemon
- local web dashboard
- Claude telemetry ingestion through OpenTelemetry

## Goals

- keep project execution legible across many repos
- launch Claude against specific feature work or direct prompts
- preserve run history, terminal output, and status writes
- expose everything through local files plus a local daemon
- stay compatible with a future remote shared-host design

## Current Non-Goals

- no remote auth
- no shared remote host
- no multi-agent support beyond Claude Code
- no interactive browser terminal
- no hosted database
- no queueing or DAG scheduler

## Primary Users

- delivery lead reviewing many projects
- tech lead tracking blockers and decisions
- engineer launching Claude work from the dashboard or terminal

## Architecture

### Repo-local state

Each project owns:

- `konductor.config.json`
- `.mcp.json`
- `.konductor/status/current.json`
- `.konductor/updates.jsonl`
- `.konductor/telemetry/latest.json`
- `.konductor/history/`
- `.konductor/runs/`

### Home-directory state

Global discovery and host state live in:

- `~/.konductor/registry.json`
- `~/.konductor/host/`

### Runtime pieces

- `konductor host`
  - launches and tracks Claude processes
  - persists run summaries and terminal logs
  - exposes local HTTP endpoints
- `konductor mcp serve`
  - supplies schema, project context, run context, and write tools
- `konductor dashboard`
  - reads project files directly
  - talks to the host daemon for live run operations

## Domain Model

### Config

- host settings
- default Claude profile
- Claude profiles
- prompt packs

### Status snapshot

- project state
- phases
- issues
- links
- optional run context

### Update entry

- message
- agent
- optional `run_id`
- optional `profile_id`
- optional `feature_item_id`
- optional `source`
- optional `task_state`

### Run summary

- run identity
- selected profile
- prompt excerpt
- selected prompt packs
- optional feature binding
- exact command string
- sanitized env summary
- status
- start/end times
- exit code
- saved terminal log path
- update/status counters

## Dashboard Behavior

The dashboard now has four project tabs:

- `Status`
- `Features`
- `Agents`
- `Project Details`

Key additions:

- feature-scoped Claude launch
- direct Claude launch from Agents tab
- running and completed task views
- read-only terminal/debug panel
- project info modal for important paths

## Compatibility

- `0.1.0` configs and snapshots are normalized into `0.2.0` shape on read
- new writes use `0.2.0`
- local files remain the source of truth even when the host is offline

## Main Risks

- Claude CLI behavior may differ across environments
- OTEL context and compaction signals remain partial
- `.mcp.json` discovery depends on local Claude setup behaving consistently
- a single local host daemon is still a v1 stepping stone, not the final shared-host model
