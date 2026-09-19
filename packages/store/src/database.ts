import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { UpdateEntrySchema } from "@konductor/schema";
import { inferUpdateTags } from "./update-tags.js";
import { backfillUpdates } from "./update-backfill.js";

/** Connections are scoped to an operation, so repo deletion and test cleanup never
 * leave cached connections pointing at unlinked databases. Callbacks must be sync. */
export function withDatabase<T>(path: string, work: (db: Database) => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
    if (version > 9) throw new Error(`Unsupported Konductor database version ${version}: ${path}`);
    if (version < 1) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS imports (source TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, repo_path TEXT NOT NULL, started_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS runs_repo_started ON runs(repo_path, started_at DESC);
        CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at DESC);
        CREATE TABLE IF NOT EXISTS updates (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        PRAGMA user_version = 1;
      `);
    }).immediate();
    if (version < 2) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS access_tokens (
          id TEXT PRIMARY KEY,
          token_prefix TEXT NOT NULL UNIQUE,
          token_hash TEXT NOT NULL UNIQUE,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS access_tokens_prefix ON access_tokens(token_prefix);
        CREATE TABLE IF NOT EXISTS token_audit_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          occurred_at INTEGER NOT NULL,
          actor_token_id TEXT,
          project_id TEXT,
          action TEXT NOT NULL,
          outcome TEXT NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS token_audit_project_time
          ON token_audit_events(project_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS token_audit_actor_time
          ON token_audit_events(actor_token_id, occurred_at DESC);
        PRAGMA user_version = 2;
      `);
    }).immediate();
    if (version < 3) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS configuration_scopes (
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body)),
          PRIMARY KEY(scope_type, scope_id)
        );
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          scope_type TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          email TEXT NOT NULL,
          credential_hash TEXT NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body)),
          UNIQUE(scope_type, scope_id, email)
        );
        CREATE INDEX IF NOT EXISTS auth_users_scope
          ON auth_users(scope_type, scope_id);
        PRAGMA user_version = 3;
      `);
    }).immediate();
    if (version < 4) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS decisions (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS decisions_status_created ON decisions(status, created_at DESC);
        PRAGMA user_version = 4;
      `);
    }).immediate();
    if (version < 5) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS preview_instances (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          port INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS preview_instances_status ON preview_instances(status);
        CREATE INDEX IF NOT EXISTS preview_instances_project_created ON preview_instances(project_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS review_sessions (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          state TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS review_sessions_created ON review_sessions(created_at DESC);
        CREATE TABLE IF NOT EXISTS change_requests (
          id TEXT PRIMARY KEY,
          review_session_id TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS change_requests_session_created ON change_requests(review_session_id, created_at DESC);
        PRAGMA user_version = 5;
      `);
    }).immediate();
    if (version < 6) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        PRAGMA user_version = 6;
      `);
    }).immediate();
    if (version < 6) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          secret_hash TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
        CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions(expires_at);
        PRAGMA user_version = 6;
      `);
    }).immediate();
    // Backfill subject/action on updates written before those fields existed, so
    // dashboard filters cover the whole feed. Rows the classifier cannot place
    // are left untagged rather than guessed.
    if (version < 7) db.transaction(() => {
      const rows = db.query<{ id: string; body: string }, []>("SELECT id, body FROM updates").all();
      const write = db.query("UPDATE updates SET body = ? WHERE id = ?");
      for (const row of rows) {
        const parsed = UpdateEntrySchema.safeParse(JSON.parse(row.body));
        if (!parsed.success) continue;
        const tags = inferUpdateTags(parsed.data);
        if (!tags.subject && !tags.action) continue;
        write.run(JSON.stringify({ ...parsed.data, ...tags }), row.id);
      }
      db.exec("PRAGMA user_version = 7");
    }).immediate();
    // Re-classify with the wider rule set and reconstruct feature history from the
    // status snapshot backups next to this database.
    if (version < 8) db.transaction(() => {
      backfillUpdates(db, dirname(dirname(path)));
      db.exec("PRAGMA user_version = 8");
    }).immediate();
    // Project spaces created from the `/root` super-admin route: a named container
    // for a `project_space` configuration scope, its users, and its registered projects.
    if (version < 9) db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_spaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          body TEXT NOT NULL CHECK(json_valid(body))
        );
        CREATE INDEX IF NOT EXISTS project_spaces_created ON project_spaces(created_at DESC);
        PRAGMA user_version = 9;
      `);
    }).immediate();
    return work(db);
  } finally {
    db.close();
  }
}

/** Import and marker commit together. Failed validation leaves the source retryable.
 * Legacy files remain untouched and are never treated as newer than DB records. */
export function importOnce(db: Database, source: string, work: () => void): void {
  if (db.query("SELECT 1 FROM imports WHERE source = ?").get(source)) return;
  db.transaction(() => {
    if (db.query("SELECT 1 FROM imports WHERE source = ?").get(source)) return;
    try {
      work();
    } catch (error) {
      throw new Error(`Failed to import legacy state from ${source}: ${String(error)}`, { cause: error });
    }
    db.query("INSERT INTO imports (source) VALUES (?)").run(source);
  }).immediate();
}

export function legacyJson(path: string): unknown | undefined {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : undefined;
}

export function readDocument<T>(db: Database, key: string, parse: (value: unknown) => T): T | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM documents WHERE key = ?").get(key);
  return row ? parse(JSON.parse(row.body)) : null;
}

export function writeDocument(db: Database, key: string, value: unknown): void {
  db.query("INSERT INTO documents VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body")
    .run(key, JSON.stringify(value));
}

export function importDocument<T>(db: Database, key: string, path: string, parse: (value: unknown) => T): void {
  importOnce(db, path, () => {
    const raw = legacyJson(path);
    if (raw !== undefined && !db.query("SELECT 1 FROM documents WHERE key = ?").get(key)) {
      writeDocument(db, key, parse(raw));
    }
  });
}
