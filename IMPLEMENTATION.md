# Konductor

## Purpose

Konductor is a control surface for agent-assisted software delivery. It keeps project
status, agent work, runs, files, telemetry, and optional managed assets visible in
one operational workspace.

The operator loop is simple:

1. initialize a repository;
2. start the host or dashboard;
3. launch a coding agent for a feature or direct task;
4. inspect progress, terminal output, status, and assets in one place.

## Product Boundaries

Implemented now:

- Bun CLI, host service, React/Vite dashboard, and MCP bridge.
- Project config and status, with SQLite for frequently changing operational
  state.
- Adapter-driven agents: built-in adapters span several provider ecosystems, and user
  and project manifests may extend the set.
- Tmux-backed agent fleet with a dashboard read-and-send mirror and terminal takeover.
- Feature-scoped and direct task launches, worktrees, prompt packs, skills registry,
  run history, telemetry, and file inspection.
- Optional asset library with nested folders, logical assets, variations,
  provenance, usage state, and opt-in agent metadata.
- Access-token identity foundation: one Konductor-managed internal identity per
  project agent profile, project-scoped external MCP tokens, explicit capability
  grants, expiry/revocation, and an authorization audit log.
- Scope configuration for projects and Project Profiles: appearance, GitHub connection,
  access-token management, local user/admin records, authentication readiness, and
  persisted SSH reverse-tunnel plans.
- Preview instances: the host runs a project branch's dev command in its own worktree
  and tmux window on a port drawn from a host-wide preview range, avoiding operator-
  reserved ports; the `/preview/:id/` proxy can serve it through the host port.
- Customer reviews: tokenized review links that frame a preview instance, collect
  pointer-annotated change requests, and list them for the operator.
- `/root`: a super-admin route, separate from dashboard sessions, guarded by a
  32-character key generated once by `konductor setup`. It lists persisted project
  spaces and creates new ones, each with its own admin account.
- First-run onboarding: a single "Proceed" screen shown once per browser before the
  dashboard renders.

Not implemented:

- queues, DAG scheduling, or interactive browser terminals;
- asset submission approval, generated asset previews, and asset-level customer
  feedback workflows;
- persistent project profiles, profile-aware registration, or profile APIs;
- remote MCP transport, remote host exposure, login/session handling, invitations,
  live tunnel supervision, and end-to-end authorization on every host/dashboard
  route.

Progress comes from status phase/item rollups, not telemetry.

## Architecture

### Project state

Each initialized repository owns human-readable configuration and status plus
operational state:

```text
konductor.config.json
.konductor/
  status/current.json
  state.sqlite                    # updates, decisions, telemetry, asset metadata, reviews
  history/
  backups/
  runs/
  assets/files/
```

`konductor.config.json` is currently written as `0.3.0`. The schemas in
`packages/schema` are the source of truth; the store normalizes supported older
formats on read. Status remains a complete JSON snapshot with backups, while SQLite
owns mutable operational records. See [STORAGE.md](./STORAGE.md) for migration,
concurrency, and backup rules.

### Machine-level state

The host state store contains the project registry, authoritative run summaries,
preview instances, host-wide port settings, scope configuration, password-hashed local user records, access-token hashes, and
authorization audit events, plus PID/state/log files, mirrored run logs, protected
internal-token secrets, and isolated harness configuration under
`harnesses/<adapter-id>`. `KONDUCTOR_HOME` can relocate this installation state; all
participating Konductor processes must use the same value.
Missing built-in harnesses can be installed, after explicit operator confirmation,
under `harnesses/<adapter-id>/runtime` without replacing system installations.

### Runtime pieces

- `konductor host` runs the process supervisor and HTTP API.
- `konductor agent` asks that host to create and supervise a tmux-backed harness.
- `konductor mcp serve` exposes project/run context, status/update mutation tools,
  and decision tools (list, create, resolve); it exposes asset tools only for enabled
  project and agent-profile combinations.
- The dashboard reads project data and calls the host for live operations.
- `konductor preview` and `konductor ports` manage preview instances and the ports
  they may use.

### Access identities and permissions

Access tokens are identities as well as credentials. Internal tokens are created and
rotated by Konductor, bound to exactly one project and agent profile, injected into
host-launched agents, and used to attribute MCP actions. External tokens are shown
once at creation, can expire or be revoked, and carry one or more explicit project
grants. Roles expand to persisted capabilities at issuance so later role changes do
not silently increase an existing token's authority; custom grants support strict
least privilege. Token hashes and audit events live in host SQLite. Recoverable
internal secrets live separately under a mode-restricted host secrets directory.

Every MCP session must authenticate, and every protected tool call rechecks the token's
current project grant, capability, expiry, and revocation state. Successful tool calls,
not process starts, update token usage. Failed startup and per-call authentication is
also audited. Host-launched profiles receive their internal credential automatically;
independently launched agents must supply a scoped external credential through the
environment or a protected token file. Only an internal token matching the injected
profile may carry run/profile attribution; external credentials cannot claim injected
run, feature, or agent-profile identity.

### Dashboard sessions and authorization

Local users (`AuthUser` in `packages/schema`) belong to a Project Space and sign in
to the dashboard with email and password. Passwords are salted scrypt hashes. A successful sign-in creates a
server-side session and hands the browser one HttpOnly, SameSite=Lax cookie whose
value is an AES-256-GCM envelope (host-only key under the secrets directory) around
the session id and a random secret; the database stores only the secret's SHA-256,
so neither a copied cookie nor a copied database alone resumes a session. Sessions
expire after 30 days, can be revoked individually or all at once, and die with the
user's disablement. Sign-in attempts are throttled per address and audited alongside
token events.

The shared route table carries one guard. While no configuration scope has enabled
authentication the dashboard stays open, as before. Once any scope enables it, every
`/api` route except sign-in and customer review links needs a live session plus the
permission the policy table (`packages/api/src/auth/policy.ts`) assigns to that
method and path; state-changing requests must also come from the dashboard's own
origin. Roles expand to dashboard permissions (`AUTH_ROLE_PERMISSIONS`); today both
`admin` and `member` expand to the full set, so the enforcement path is exercised
while no capability is withheld yet. The host's terminal WebSocket honours the same
session, in development through the Vite proxy and in production directly.

This is not a claim that Konductor is ready to bind a host to a public interface. The
host remains loopback-only, its native (non-`/api`) routes serve the CLI without a
session, and remote transport and invitation flows must still be added.

### Root route

`/root` is a break-glass super-admin surface, deliberately outside the dashboard
session/permission system above: it exists to create the accounts that system
depends on, so it cannot depend on them itself. `konductor setup` generates a single
32-character key once, under `<KONDUCTOR_HOME>/secrets/root.key` (mode 600), and
prints it exactly once. Posting that key to `/api/root/login` sets a separate,
stateless, AES-256-GCM-sealed session cookie good for 12 hours; there is no per-visit
database row, so revoking every root session means deleting
`<KONDUCTOR_HOME>/secrets/root-session.key` to invalidate the encryption key. Root
login attempts share the dashboard's login throttle.

A project space (`ProjectSpace` in `packages/schema`) is a named, persisted
`project_space` configuration-scope id; `/root` lists existing spaces and creates new
ones, and creating one also creates its first admin (`AuthUser`, scope `project_space`)
in the same call. This does not yet namespace project registration itself — see
"Project Profiles" and "Next Work" below.

## Agent Runs

An agent profile selects an adapter, provider, model, environment, and default
working directory. The adapter manifest supplies the executable, launch/resume
arguments, MCP format, telemetry support, and screen-status patterns. Provider and
model validation happens at launch.

For each run, the host:

1. resolves the profile, optional feature, prompt packs, overrides, and worktree;
2. creates a run summary and a tmux window/pane;
3. injects run metadata into the harness environment;
4. samples the pane to classify working, idle, blocked, or dead state;
5. persists terminal logs and final run status.

The dashboard and CLI can inspect, message, stop, or attach to live agents. Run
records are retained separately from live tmux state, so a host restart can re-adopt
surviving windows and finalize missing ones.

## Preview Instances and Customer Reviews

A project opts in with a `preview` block in `konductor.config.json`: the dev command
(`{port}` is substituted and the port is also exported under `port_env`), an optional
install command for fresh worktrees, a readiness path, and a timeout. Starting a
preview for a branch checks it out into a sibling worktree (`<repo>-preview-<branch>`;
a branch already checked out somewhere is reused in place), allocates the first free
port in the host's preview range that is neither reserved, held by another live
preview, nor already bound, and runs the command in a tmux window in the project's
session. The host polls the readiness path until the instance is `ready`, then watches
pane liveness; failures keep the pane's last screen as `last_error`. Live previews
keep the host from idling out and are re-adopted after a restart. Stopping leaves the
worktree unless removal is requested.

Port settings are machine-wide and live in the `host`/`local` configuration scope:
a preview range (default 4200–4299) and reserved ranges with labels. Reserving a port
a live preview holds is refused. Configuration › Ports and `konductor ports` edit them.

A review link binds a title, a preview instance, a page list (label + path), an
expiry, and an access mode. `direct` sends the customer's browser to the preview port
on the dashboard's hostname; `proxied` uses `/preview/<id>/…` on the host port (HTTP
and WebSocket), which suits a single exposed port but requires the previewed app to
serve assets relative to that prefix. The token is shown once; only its hash is stored
in the project database. The customer page frames the preview, overlays numbered
pointers, and posts change requests (summary, pointers, viewport, optional name).
Requests appear in the Reviews tab with an operator-managed status. The token is the
only guard on customer routes, consistent with the loopback-only host.

## Dashboard

The portfolio provides project-level status, activity, token usage, and path
inspection. A project has these tabs:

- Status: updates, phases, blockers, decisions, dependencies, tokens, and activity.
- Features: feature categories, multi-phase feature filtering, feature-bound launches,
  and the decisions linked to each feature.
- Agents: harness-first launch, profiles, prompt packs, skills, active fleet, and
  completed work.
- Assets: optional managed asset workspace.
- Reviews: preview instances per branch, review links, and customer change requests.
- Project Details: repository file browser and reader.

The portfolio Project Profile menu and each project header also open a scoped
configuration surface. General appearance, a GitHub connection, and external access
tokens exist per project or Project Profile; remote planning, port settings, and
local authentication users belong to the Project Profile (space) only, and the API
refuses them for a project scope. Users and settings created under the older
per-project scope were moved into the `personal` space by database version 7. GitHub uses a verified personal access token kept
in host-only secret storage; only the connected account metadata is retained in scope
configuration. Token creation can grant one credential to one or more registered projects.

The visual direction and interaction constraints live in [DESIGN.md](./DESIGN.md).

## Decisions

A decision is a SQLite-backed project record (`Decision` in `packages/schema`), not a
snapshot field: a title and question, an impact, optional context and owner, a list
of options, links to any number of feature items, and, once resolved, an outcome.
Agents raise decisions through MCP (`create_decision`) instead of choosing themselves;
operators record them in the dashboard; the legacy `issues.decisions_needed` list is
imported once and mirrored from `write_status` for older agents.

Resolving picks one option and records the rationale, who resolved it, and when. An
option may declare features it creates when chosen; the operator can edit that list
before resolving, and each created feature lands in the chosen category and phase and
is linked back to the decision. The operator may also hand the chosen option to an
agent: the run launches with `decision_id`, the host adds a "Decision Hand-off" block
(question, chosen option, rationale, rejected options, linked and created features)
to the brief, and the run id is stored on the outcome. A failed launch leaves the
decision resolved and reports the error. Features show their linked decisions and
outcomes, and any agent launched for a feature sees those decisions in its brief.

## Asset Manager

Asset management is off by default per project. Enabling it selects the agent
profiles that may receive asset instructions; disabling it stops injection and keeps
the existing library intact.

- A folder (`AssetBucket`) carries placement instructions, accepted types, upload
  protection, and opt-in descriptive metadata. Folders nest through `parent_id`;
  `null` marks a root folder. Built-in presets are no relation, page based, type
  based, and custom.
- The reserved `uncategorized` bucket holds loose assets at the library root. It is
  never shown as a folder, cannot be moved or deleted, and is the fallback when a
  folder is deleted: deleting a folder removes its whole subtree and moves every
  asset in it to the root.
- A logical asset belongs to one folder and has one or more independently managed
  variations. Several variations may be marked used at the same time. Assets and
  folders can be moved; a folder cannot be moved into itself or a descendant.
  Managed file paths are not rewritten on move.
- Variations record file details, hash, size, approval, author, and originating
  run/profile. User uploads begin approved; agent-created variations begin pending.
- Folder and asset descriptions, tags, and fields reach agents only when their own
  `expose_to_agents` setting is on. Technical variation data remains available to
  enabled agents.
- Managed copies stay under `.konductor/assets/files`; source paths and served files
  are constrained to project-managed roots. Uploads are capped at 25 MB.

Implemented operator APIs cover settings, folders (create, move, settings, metadata,
recursive delete), items (create, move, metadata, delete), variations, and content.
Asset submissions, approval decisions, generated asset previews, external analytics,
and public asset APIs are deliberately deferred; customer review of running branches
lives in the Reviews tab, not in the asset library.

## Project Profiles

A Project Profile is an account-like overview context, not an agent profile. The
portfolio has an overview-only switcher that can create and switch in-memory browser
prototype contexts, including an empty profile state. Configuration values can be
stored against a Project Profile id, but profile membership itself does not currently
persist, move registrations, namespace host data, or change project files.

When persistence is implemented, migration must adopt the existing registry into one
default profile without changing project IDs, paths, run history, or repository data.
Project movement must change registry membership only, never silently copy or delete
repositories. The profile switcher must stay off project, agent, asset, and review
screens.

## Next Work

1. Stabilize and verify adapter invocation behavior, especially unverified adapters.
2. Turn Project Profiles from a browser prototype into explicit persisted registry
   namespaces, with safe migration and CLI/API support.
3. Build an asset submission and operator-approval workflow; harden customer review
   links (rate limiting, per-viewer identity) before exposing a host publicly.
4. Improve terminal mirroring within the explicit operator-control model.
5. Complete shared-host deployment: narrow member permissions, apply the token
   authorizer to the host's native routes, then add user/invitation ownership, remote
   transport, host-owned file APIs, and a deliberate multi-machine storage design.
