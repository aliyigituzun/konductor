# Konductor Usage Guide

## Daily flow

```bash
konductor init
konductor host start
konductor agent start --slug blockers --task "Review the current blockers and propose next changes"
konductor agent list
konductor agent read blockers
konductor agent attach blockers
```

`init` creates `konductor.config.json`, adapter MCP configuration, initial status,
runtime directories, and a registry entry. `host start` runs the supervisor. Agents
run in separate tmux panes; use `read` for a snapshot, `send` for a follow-up, and
`attach` to take over the actual terminal.

## Launch options

```bash
konductor agent start \
  --profile <agent-profile> \
  --packs <pack-a,pack-b> \
  --feature <feature-item-id> \
  --provider <provider> \
  --model <model> \
  --worktree \
  --task-file <brief.md>
```

An agent profile selects the harness, provider, and model. Konductor discovers
built-in, user, and project adapter manifests across Anthropic, OpenAI, Google, and
other compatible providers. Add user adapter manifests to `~/.konductor/adapters/`.
Prepare a harness's isolated MCP integration with:

```bash
konductor adapters setup <adapter-id>
```

Setup is stored under `KONDUCTOR_HOME/harnesses/<adapter-id>` and injected only into
Konductor-launched sessions. It does not rewrite the harness's normal user or project
configuration. If Claude Code, Codex, Gemini CLI, OpenCode, or Pi is missing,
interactive setup asks for `y/N` permission before installing its official npm package
under `KONDUCTOR_HOME/harnesses/<adapter-id>/runtime`. Managed runtimes do not replace
system binaries. Harness state and authentication are isolated through the harness's
supported configuration environment; subscription users may need to authenticate once
inside each Konductor-managed setup. Pi additionally installs `pi-mcp-adapter` into
its isolated agent directory.

Use `konductor run list`, `run show <id>`, `run logs <id>`, or `run stop <id>` for
durable run records. Use `konductor doctor` when setup, host, adapter, MCP, or
telemetry checks are needed.

## Dashboard

```bash
konductor dashboard
```

The dashboard opens a portfolio and per-project tabs:

- Status: updates, phases, blockers, decisions, dependencies, tokens, and activity.
  Click a decision to choose an option, add features it should create, and
  optionally hand the chosen option to an agent with further instructions.
- Features: feature categories, multi-select phase filtering, feature-scoped launches,
  and each feature's linked decisions with their outcomes.
- Agents: direct launches, agent configuration, tmux fleet, and completed tasks.
- Assets: optional folder/asset/variation library for enabled agent profiles.
- Reviews: start a preview of any branch, mint customer review links, and triage the
  change requests customers submit.
- Project Details: file browser and reader for project documentation and source files.

The dashboard terminal mirrors a pane and can send messages, but `konductor agent
attach <slug>` remains the way to take over an agent terminal.

To try the decisions flow on a fresh project, `bun run seed:decisions [repoPath]`
inserts sample open and resolved decisions; re-running it is a no-op.

Open Configuration from the gear in a project header for that project's General,
Integrations, and Access tokens settings. On the portfolio, open the Project Profile
switcher and choose **Configure** for the Project Space, which additionally owns
Remote, Ports, and Authentication:

- General: follow the system theme or choose light/dark explicitly.
- Remote (Project Space): store an SSH reverse-port-forward plan. This is a scaffold
  only; Konductor does not start or supervise the tunnel. While authentication is
  off, this tab suggests enabling it before sharing the dashboard.
- Ports (Project Space): machine-wide. Set the preview range and write down ports
  other services occupy so previews never land on them.
- Access tokens: create external agent credentials, select every project where the
  token is valid, inspect managed internal identities, and revoke external tokens.
- Authentication (Project Space): create the first administrator and additional
  local users, then require authentication. From that moment every dashboard request needs a signed-in
  session: the dashboard shows a sign-in screen, the header gains a sign-out button,
  and customer review links stay public. Members currently hold the same permissions
  as administrators.

Remote readiness cannot be enabled until the scope has an active administrator and
authentication is enabled. Passwords are hashed; external plaintext tokens are shown
only once.

## MCP and assets

MCP configuration follows the selected adapter's format and is kept in Konductor's
isolated harness directory. `konductor mcp serve` is useful for direct debugging.
Every MCP process requires an access token. Konductor injects managed internal tokens
into host-launched profiles automatically; an external agent must receive its own
external token. Konductor rechecks expiry, revocation, project scope, and permission
on every protected MCP call, so revocation takes effect in an already-running session.
Agents can write updates and status through MCP, where Konductor adds the active run
context only when a managed internal token matches the launched profile. External
tokens are attributed to their own token identity and cannot claim a profile through
environment variables.

Every Konductor-launched agent profile has one managed internal access token. The
host injects it into runs, and MCP records the token identity, project, permission,
and action in the authorization audit log. Denied authentication attempts are recorded
too, and token usage counts successful authorized calls rather than process launches.
Reconcile those identities after manual
config edits with:

```bash
konductor tokens sync
```

Create a scoped credential for an external agent and pass it to a local MCP process:

```bash
konductor tokens create --name "Review agent" --role contributor --expires-in 7d
KONDUCTOR_ACCESS_TOKEN='<token>' konductor mcp serve
```

An external token is not another MCP server. Add the Konductor MCP server to the
agent once, then provide its token through the agent's secret/environment facility.
If the client has no secret store, put the token in a user-owned file with mode
`0600` and keep only the file path in the MCP configuration:

```json
{
  "mcpServers": {
    "konductor": {
      "type": "stdio",
      "command": "konductor",
      "args": ["mcp", "serve", "--token-file", "/absolute/private/path/konductor-token"]
    }
  }
}
```

Do not put plaintext tokens in `.mcp.json`, `konductor.config.json`, shell history,
or a repository. Give each external agent a separate token so revocation and audit
attribution remain precise.

Use `konductor tokens list`, `tokens revoke <id>`, and `tokens audit` for lifecycle
and inspection. External plaintext tokens are displayed only at creation. Custom
roles accept repeatable `--permission` flags; run `konductor tokens help` for the
capability list. The host is still loopback-only—these credentials prepare remote
collaboration but do not enable a public remote MCP or dashboard endpoint.

Asset management is disabled by default. Enable it in the Assets tab, choose the
agent profiles that may receive asset context, then create folders and assets.
Folders nest; the breadcrumb at the top of the Assets section shows where you are,
and assets uploaded at the root stay loose there. Deleting a folder removes its
subfolders and drops their assets back to the root.
Each asset may have many variations, and any number may be marked used. Descriptive
metadata reaches an agent only when explicitly exposed. Asset submissions and
approvals are not available yet.

## Customer previews and reviews

Add a `preview` block to `konductor.config.json` so Konductor knows how to run the
project. `{port}` is substituted and the port is also exported as `PORT`:

```json
"preview": {
  "command": "cd apps/web && bun --bun vite --port {port} --strictPort",
  "install_command": "bun install --frozen-lockfile",
  "ready_path": "/"
}
```

In the Reviews tab choose **New preview**, pick a branch, and start it. The host
checks the branch out into a sibling worktree, picks a free port from the preview
range, and runs the command in a tmux window named `preview-<id>`; **Output** shows
the pane. Then **New review link**: give it a title, the preview, the pages the
customer should look at, and an expiry. The link is shown once. Direct access sends
the customer to the preview port on this machine's hostname; the host proxy serves it
under `/preview/<id>/` on the host port instead (the app must serve assets relative
to that prefix). The customer places numbered pointers over the framed app and
submits change requests, which appear under **Change requests** with a status you
control. From the CLI, `konductor preview start --branch <name>`, `preview list`, and
`preview stop <id>` do the same, and `konductor ports` manages the range and
reservations.

## Data and documents

Project config/status live in the repository; mutable operational records use
SQLite. See [STORAGE.md](./STORAGE.md) before upgrading, relocating
`KONDUCTOR_HOME`, or backing up an active installation.

[IMPLEMENTATION.md](./IMPLEMENTATION.md) is the product and architecture source of
truth. Use [CLI_IMPLEMENTATION.md](./CLI_IMPLEMENTATION.md) for command details and
[DESIGN.md](./DESIGN.md) for dashboard direction.
