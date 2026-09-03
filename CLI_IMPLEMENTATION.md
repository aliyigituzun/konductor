# Konductor CLI Implementation

## Purpose

The CLI now has four responsibilities:

1. initialize and migrate repos into Konductor
2. expose a local Claude host and MCP bridge
3. inspect status, issues, telemetry, and run state
4. launch and control Claude runs from the terminal

## Command Surface

### `konductor init`

- write `konductor.config.json` at schema `0.2.0`
- seed one default Claude profile
- seed one default prompt pack
- write `.mcp.json`
- create `.konductor/runs/`
- write initial status snapshot
- register the project globally

### `konductor host start|stop|status`

- manage the local host daemon
- validate the default Claude binary before starting
- persist daemon pid and state under `~/.konductor/host/`

### `konductor run start`

- send a launch request to the host
- support `--prompt`, `--profile`, `--packs`, and `--feature`
- create a run record and terminal log

### `konductor run list|show|logs|stop`

- inspect run summaries
- inspect saved terminal output
- stop active Claude runs

### `konductor mcp serve`

- expose Konductor MCP over stdio
- return project context and run context
- let Claude write updates and status with run metadata
- start the OTEL receiver if needed

### Existing Read Commands

- `konductor status`
- `konductor issues`
- `konductor stats`
- `konductor sync`
- `konductor doctor`
- `konductor dashboard`
- `konductor delete`

These still work, but now include run- and host-aware metadata where relevant.

## Storage Layout

### Repo-local

```text
konductor.config.json
.mcp.json
.konductor/
  status/current.json
  telemetry/latest.json
  history/
  backups/
  runs/
    <run-id>.json
    <run-id>.log
  updates.jsonl
```

### Home directory

```text
~/.konductor/
  registry.json
  host/
    host.pid
    host.log
    state.json
    runs/
      <run-id>.json
    logs/
      <run-id>.log
```

## Host Responsibilities

The host daemon is the only process that should launch Claude runs initiated by Konductor.

It is responsible for:

- validating the selected Claude profile
- composing the final prompt payload
- injecting run env vars
- spawning Claude
- capturing stdout/stderr
- mirroring run summaries and logs into repo-local and global storage
- exposing HTTP endpoints for the dashboard and CLI

## Run Lifecycle

1. The operator starts a run from the dashboard or CLI.
2. The host allocates a `run_id`.
3. The host composes prompt packs, feature context, and operator prompt.
4. The host spawns Claude with run env vars.
5. The host writes:
   - a run summary JSON
   - a terminal log
   - a milestone update noting that the run started
6. If Claude uses MCP, `write_update` and `write_status` stamp the run metadata.
7. When the process exits or is stopped, the host updates the run summary and appends a completion update.

## MCP Layer

Konductor MCP now serves:

- `get_status_schema`
- `get_current_status`
- `get_project_context`
- `get_run_context`
- `write_update`
- `write_status`

Important behavior:

- `write_update` and `write_status` attach `run_id`, `profile_id`, `feature_item_id`, and `source` when present
- status writes also stamp the `run` object into the status snapshot
- run summaries increment their update/status counters from MCP writes

## Doctor Coverage

`konductor doctor` now checks:

- config presence
- `.konductor/` presence
- registry readability
- status validation
- project registration
- Claude binary resolution
- `.mcp.json` presence
- host storage location
- host daemon reachability
- OTEL endpoint reachability

## Design Constraints

- Claude Code only
- no remote host
- read-only dashboard terminal
- project files remain the source of truth
- run summaries are mirrored into both repo-local and host-global storage
