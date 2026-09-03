# Konductor Implementation Plan

## Delivery Principle

The current implementation proves one local orchestration loop:

1. initialize a repo into Konductor
2. start the local Claude host
3. launch Claude from the dashboard or CLI
4. let Claude write updates/status through Konductor MCP
5. inspect runs, logs, files, and telemetry in one place

## Current Build Sequence

### 1. Shared contracts

- upgrade config, registry, telemetry, status, and update contracts to `0.2.0`
- add run summary and host state contracts
- keep read compatibility for `0.1.0`

### 2. Repo-local storage

- add `.konductor/runs/`
- keep status, updates, telemetry, and history file-backed
- keep backups for status writes

### 3. Global host storage

- add `~/.konductor/host/`
- persist daemon state
- persist mirrored run summaries and logs

### 4. Initialization

- seed Claude profile and prompt pack defaults
- seed host defaults
- seed `.mcp.json`
- seed `.claude/settings.local.json` OTEL settings

### 5. Claude host daemon

- run a local HTTP service
- validate the Claude profile
- spawn Claude
- capture stdout/stderr
- update run metadata

### 6. MCP bridge

- return schema
- return project context
- return run context
- accept update and status writes
- stamp run metadata into saved files

### 7. CLI control surface

- `host start|stop|status`
- `run start|list|show|logs|stop`
- updated `status`, `stats`, `sync`, and `doctor`

### 8. Dashboard control surface

- feature-driven launch
- direct launch in `Agents`
- running/past task views
- read-only terminal panel
- project path info modal

### 9. Verification

- typecheck all packages
- run unit tests
- initialize a disposable project
- start host and dashboard
- exercise run flows from CLI

## Future Work

- shared remote host
- multi-agent support
- interactive browser terminal
- queueing and richer orchestration
- hosted sync and auth

## Main Source Of Truth

Supporting documents:

- [TDD.md](./TDD.md)
- [STATUS_SCHEMA.md](./STATUS_SCHEMA.md)
- [CLI_IMPLEMENTATION.md](./CLI_IMPLEMENTATION.md)
- [DESIGN.md](./DESIGN.md)
- [USAGE.md](./USAGE.md)
