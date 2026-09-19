# Konductor CLI

## Scope

The CLI initializes projects, supervises coding-agent work, exposes the MCP bridge,
and reports project state. Agents run in tmux panes.

## Commands

### Project and host

- `konductor setup` (also `scripts/setup.sh`, which installs dependencies and builds
  first) is the one-time machine bootstrap: it generates the 32-character root key
  that guards the dashboard's `/root` super-admin route, printing it once and saving
  it mode-600 under `<KONDUCTOR_HOME>/secrets/root.key`. Re-running when a key already
  exists is a no-op; delete the file first to rotate it.
- `konductor init [--empty]` writes `0.3.0` config, an initial agent profile and
  prompt pack, adapter MCP configuration, runtime directories, initial status, and
  a registry entry. It writes adapter-specific telemetry defaults when applicable.
- `konductor projects`, `delete`, `status`, `issues`, `stats`, `sync`, and `doctor`
  manage registration and inspect project state. `issues` lists blockers, open and
  resolved decisions (from the project database), dependencies, and risks. `sync` writes bounded history;
  `doctor` checks config, registration, status, MCP setup, adapters, host, and
  telemetry where available.
- `konductor host start|stop|status` manages the host daemon.
- `konductor dashboard [--background|--stop]` starts or stops the Vite dashboard and
  ensures the host is available before launch.

### Agent fleet

`konductor agent start` launches a task through the host:

```bash
konductor agent start --slug login --task "Fix the failing login tests"
```

It accepts `--task` or `--task-file`, plus `--profile`, `--packs`, `--feature`,
`--slug`, `--provider`, `--model`, and `--worktree`. The selected adapter manifest
validates the provider/model and controls the harness invocation.

`konductor agent list|send|read|status|explain|stop|attach` manages live agents.
Each agent receives a tmux window and the CLI returns an attach command. The host
re-adopts surviving windows after a restart and finalizes records for missing ones.

`konductor adapters list|show|setup` reports built-in, user, and project adapter
manifests and prepares their isolated MCP integration. Setup state lives under
`KONDUCTOR_HOME/harnesses/<adapter-id>` and is injected only into Konductor-launched
processes. When Claude Code, Codex, Gemini CLI, OpenCode, or Pi is absent, the
interactive command requires explicit `y/N` approval before installing its official
npm package under that harness directory. Runtime state is redirected into the same
Konductor-owned area through each harness's supported environment. Pi setup also
installs `pi-mcp-adapter` in its isolated `PI_CODING_AGENT_DIR`.
The built-in set spans several provider ecosystems; the command is the current
authoritative inventory.

### Previews and ports

`konductor preview start --branch <name> [--project <id>]` asks the host to run the
project's `preview.command` for that branch in a worktree on a free preview port;
`preview list` and `preview stop <id> [--remove-worktree]` inspect and end them.
`konductor ports list|reserve <port|a-b> [--label]|release <port|a-b>|range <a-b>`
edits the machine-wide port settings the allocator consults; they need no host.

### Run records

`konductor run start|list|show|logs|stop` launches or inspects durable run records.
Run data includes selected profile, feature binding, command, sanitized environment,
terminal log, lifecycle timestamps, and update/status counters.

### MCP and telemetry

`konductor mcp serve` exposes project context, run context, status schema/current
status, status/update writes, decision tools (`list_decisions`, `create_decision`,
`resolve_decision`, guarded by `decisions.read`/`decisions.write`), and conditionally
enabled asset tools. Run metadata is stamped onto MCP writes. `konductor telemetry start|stop|status` controls the
OpenTelemetry receiver.

`konductor tokens list|create|revoke|sync|audit` manages access identities. `sync`
maintains one internal token per configured agent profile. `create` issues an
external token bound to a project and a persisted role/capability set; the plaintext
is shown once. `mcp serve` accepts it through `KONDUCTOR_ACCESS_TOKEN`,
`KONDUCTOR_ACCESS_TOKEN_FILE`, or `--token-file`; it revalidates expiry, revocation,
project scope, and capability for every protected tool call and records allowed/denied
authorization events. Usage counters advance per successful authorized call. External
tokens cannot adopt run/profile attribution from caller-controlled environment values.
Every MCP session requires a token. Host-launched profiles receive their managed
internal credential automatically; independently launched agents must supply an
external credential. Tokenless stdio sessions fail before the MCP transport starts.

## Storage and lifecycle

The repository keeps configuration, status snapshots, logs, managed asset bytes, and
`.konductor/state.sqlite` for updates, telemetry, and asset metadata. The user-level
Konductor database keeps the registry, authoritative run summaries, token hashes,
and authorization audit; its host directory keeps host state and mirrored run logs.
`KONDUCTOR_HOME/secrets/tokens` holds recoverable internal agent credentials with
restrictive modes. `KONDUCTOR_HOME/harnesses` owns
adapter-specific MCP setup without changing the harnesses' normal local config.

For a launch, the host resolves profile, prompt packs, feature context, overrides,
and optional worktree; creates a run record and tmux pane; injects run context; then
captures output and final status. Repository files remain authoritative for project
configuration/status; host SQLite is authoritative for run summaries.

See [STORAGE.md](./STORAGE.md) for migration, backup, and concurrency details.
