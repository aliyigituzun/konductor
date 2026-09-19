# Storage ownership and SQLite migration

Konductor uses Bun's embedded SQLite driver for frequently mutated operational
state. SQLite remains a file-backed store with no backend dependency.
Storage access stays behind `@konductor/store`; API response schemas are unchanged.

## Storage decisions

| Data | Current storage | Reason |
| --- | --- | --- |
| Project registry | `$KONDUCTOR_HOME/state.sqlite`, `projects` table | Independent keyed upserts avoid rewriting other projects. |
| Run summaries and counters | Same host database, indexed `runs` table | One authoritative record for CLI, host and MCP; transactional increments; indexed project/time queries. |
| Access-token hashes | Same host database, `access_tokens` table | Credentials are verified centrally; external plaintext tokens are shown once and never persisted. |
| Authorization audit | Same host database, indexed `token_audit_events` table | Project/identity/action attribution is queryable without scanning logs; the newest 25,000 events are retained. |
| Project/Profile/host configuration | Same host database, `configuration_scopes` table | General, authentication-readiness, remote-plan, and (for the `host`/`local` scope) port settings need stable scope ownership without rewriting project files. |
| Preview instances | Same host database, indexed `preview_instances` table | Ports are machine-wide, so the allocator must see every project's live previews in one place; records survive host restarts for re-adoption. |
| Local authentication users | Same host database, `auth_users` table | Scoped identities are queryable centrally; credentials are salted scrypt hashes and are never returned by APIs. |
| Dashboard sessions | Same host database, `auth_sessions` table | Sessions are revocable server-side; the row holds only a SHA-256 of the session secret, so a copied database cannot resume a session. |
| Project updates | `.konductor/state.sqlite`, `updates` table | Transactional append, stable insertion order and unique IDs. |
| Review sessions and change requests | Project database, `review_sessions` (unique `token_hash`) and `change_requests` tables | Customer links belong to the project; the plaintext token is never stored and lookup by token is one indexed read. |
| Decisions | Project database, `decisions` table | Keyed records with options and outcomes; resolve is one transaction. Legacy `issues.decisions_needed` entries are imported once as open decisions. |
| To-dos | Project database, `todos` table | Whole-snapshot writers (MCP `write_status`, older processes) replace the status file and dropped to-dos kept there. `readStatus` overlays the table and derives `todo_id` on feature items; `writeStatus` never persists `todos`. Legacy snapshot `todos` are imported once. |
| Latest telemetry | Project database, `documents` table | Transactional merge/reset against the latest committed aggregate. |
| Asset library metadata | Project database, `documents` table | Category, asset and variation edits commit atomically without losing concurrent uploads. |
| Project config, MCP settings, adapter manifests | Existing JSON files | Human-editable configuration and external tool contracts. |
| Rolling status and backups | Existing JSON files | A complete interchange snapshot with existing direct-file workflows and backups. |
| Sync history | Existing JSON files, capped at 30 | Small bounded summaries; current use does not need a query engine. |
| Asset bytes, terminal/daemon logs | Existing files | Large binary/streaming content is served or tailed without rewriting database pages. |
| Host state and PID files | Existing files | Small daemon discovery records, not a multi-writer collection. |
| Internal token secrets | `$KONDUCTOR_HOME/secrets/tokens`, mode-restricted files | Managed agents need a recoverable credential; secrets stay separate from queryable token metadata and hashes. |
| Session cookie key | `$KONDUCTOR_HOME/secrets/session.key`, mode 0600 | The browser cookie is AES-256-GCM sealed under this host-only key; deleting the file signs everyone out. |
| Project-profile membership | No new persistence | Profile configuration may persist by id, but membership does not persist yet. |
| Preview worktrees | Sibling directories `<repo>-preview-<branch>` | Git owns the checkout; Konductor records the path and only removes a worktree it created, on request. |

`KONDUCTOR_HOME` defaults to `~/.konductor`. Set it before starting any Konductor
process to relocate host storage or isolate an installation. Project state remains
under each repository. All processes in an installation must use the same home.

Structured rows retain schema-validated JSON payloads where callers consume whole
domain objects. Run IDs, repository paths and start times are relational keys and
indexes. Asset metadata and telemetry are still aggregates, not fully normalized
SQL models; future per-variation queries or large libraries can justify splitting
those aggregates into related tables.

## Concurrency and durability

- Schema versioning uses `PRAGMA user_version`; newer unsupported schemas fail visibly.
  Migrations may rewrite row bodies as well as add tables: version 7 backfills
  `subject`/`action` on update entries by classifying legacy message shapes
  (`packages/store/src/update-tags.ts`); version 8 re-runs that classifier with
  the full rule set and reconstructs feature events that were never logged by
  diffing the status snapshot backups in `.konductor/backups/`
  (`packages/store/src/update-backfill.ts`). Reconstructed rows carry
  `agent: "konductor-migration"`; free-text notes with no recognisable shape are
  filed under `agent` when their author is not Konductor itself.
- WAL, a five-second busy timeout, and immediate write transactions coordinate
  writers across processes. Connections close after each store operation.
- Read/modify/write transactions contain synchronous database work only. Asset
  uploads finish before metadata transactions start.
- Asset deletion commits metadata before deleting file bytes. A crash or cleanup
  error can leave unreferenced files; it cannot commit a reference to bytes that
  this deletion already removed. Failed metadata insertion cleans up the upload.
- Whole-object replacement operations (for example `writeRegistry` or
  `writeRunSummary`) remain explicit replacements. Incremental callers must use
  keyed upserts, patches or counter mutations rather than stale whole objects.
- Updates, status writes, and run counters are separate operations, potentially
  across two databases. They are not a distributed transaction.
- JSON status/config writes and bounded history keep their existing concurrency
  limitations. Remote multi-writer status editing will need revision checks or a
  transactional mutation API; moving a snapshot into SQL alone would not solve it.

## Existing installations

Stop old host, dashboard, MCP and telemetry processes before upgrading. Legacy JSON
and JSONL state is imported lazily on the first corresponding store operation.
Each import and its completion marker commit in one transaction. Files are retained
unchanged for recovery, but are no longer updated for migrated data. Do not run old
and new writers together or edit legacy files expecting those edits to reach SQLite.

Invalid input fails the import visibly and rolls it back, including its marker.
Repair the reported source and retry. Imports do not overwrite existing database
rows. Global run mirrors take precedence over repo-local copies; repo-only legacy
runs are imported when that project's runs are accessed. Global listing alone does
not crawl every repository. Run schema normalization remains in place.

New run summaries exist only in the host database. Moving a repository alone does
not move its run history: move/back up host state too. Logs retain their existing
repo and host copies. Existing path fields in old registry/history records may
refer to pre-migration files; operational readers use store methods, not those hints.

For backups, stop all Konductor writers and copy both the host directory and the
project's `.konductor` directory. For live database backups, use SQLite's backup
API or `VACUUM INTO`; copying just an active `.sqlite` file can miss committed WAL
data. Retained JSON is a pre-migration recovery copy, not an up-to-date rollback.

## Distributed host deployments

The database and project files must live on the machine running the service. Clients
that are not co-located with that service must call authenticated host APIs, and file
downloads should be served by the host. Do not open SQLite files over NFS/SMB or
share WAL databases between machines. See [SQLite's network guidance](https://www.sqlite.org/useovernet.html).

Before a deployment spans multiple machines, route all operations through the host,
apply project authorization to every HTTP/MCP/WebSocket route, add real login/session
and collaborator ownership around the existing user and token identities, and replace
client-visible filesystem assumptions. Stored reverse-tunnel plans do not run a
tunnel, and the token/user stores alone do not make the currently loopback-only host
safe to expose. Multi-host concurrent writers require a server database or an
explicitly designed replication layer; SQLite file sharing is not that layer.
