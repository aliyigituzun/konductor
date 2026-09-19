import { existsSync, readdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { withDatabase, importOnce } from "./database.js";
import {
  HostStateSchema,
  RunSummarySchema,
  type HostState,
  type RunSummary,
} from "@konductor/schema";
import { GLOBAL_DATABASE, hostGlobal, repoLocal } from "./paths.js";
import { redactSensitiveText } from "./redaction.js";

/**
 * Bring a pre-0.3.0 run summary forward.
 *
 * Runs used to record `agent_kind` from a fixed three-value enum. That became an
 * open `adapter_id`, and pane fields were added. Historical runs of the removed
 * HTTP-API runners are kept rather than discarded — they really happened, they are
 * already terminal, and deleting a user's history to tidy a schema is not our call.
 */
export function migrateRunSummary(raw: unknown): RunSummary {
  const data = { ...((raw ?? {}) as Record<string, unknown>) };

  if (data["adapter_id"] === undefined) {
    data["adapter_id"] = typeof data["agent_kind"] === "string" ? data["agent_kind"] : "claude_code";
  }
  delete data["agent_kind"];

  if (data["slug"] === undefined) {
    // Old runs had no addressable name; derive a stable one from the run id.
    const id = typeof data["id"] === "string" ? data["id"] : "run";
    data["slug"] = `run-${id.slice(0, 8)}`;
  }
  if (data["transport"] === undefined) data["transport"] = "headless";
  if (data["feature_item_ids"] === undefined) {
    data["feature_item_ids"] = typeof data["feature_item_id"] === "string" ? [data["feature_item_id"]] : [];
  }
  if (typeof data["last_error"] === "string") {
    data["last_error"] = redactSensitiveText(data["last_error"]);
  }

  return RunSummarySchema.parse(data);
}

function importRuns(db: Database, dir: string): void {
  importOnce(db, dir, () => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
      // Fail visibly on invalid legacy data; the transaction and marker roll back.
      const run = migrateRunSummary(JSON.parse(readFileSync(join(dir, file), "utf-8")));
      db.query("INSERT OR IGNORE INTO runs VALUES (?, ?, ?, ?)")
        .run(run.id, resolve(run.repo_path), Date.parse(run.started_at), JSON.stringify(run));
    }
  });
}

function withRuns<T>(repoPath: string | undefined, work: (db: Database) => T): T {
  return withDatabase(GLOBAL_DATABASE, (db) => {
    // The host's legacy mirror wins conflicts; project-only records are imported on access.
    importRuns(db, hostGlobal().runsDir);
    if (repoPath) importRuns(db, repoLocal(repoPath).runsDir);
    return work(db);
  });
}

function getRun(db: Database, id: string): RunSummary | null {
  const row = db.query<{ body: string }, [string]>("SELECT body FROM runs WHERE id = ?").get(id);
  return row ? migrateRunSummary(JSON.parse(row.body)) : null;
}

function putRun(db: Database, summary: RunSummary): RunSummary {
  const parsed = RunSummarySchema.parse(summary);
  db.query(`INSERT INTO runs VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    repo_path = excluded.repo_path, started_at = excluded.started_at, body = excluded.body`)
    .run(parsed.id, resolve(parsed.repo_path), Date.parse(parsed.started_at), JSON.stringify(parsed));
  db.query("DELETE FROM run_feature_items WHERE run_id = ?").run(parsed.id);
  const insert = db.query("INSERT INTO run_feature_items (run_id, feature_item_id) VALUES (?, ?)");
  for (const featureItemId of new Set(parsed.feature_item_ids)) insert.run(parsed.id, featureItemId);
  return parsed;
}

function repoRunLogPath(repoPath: string, runId: string): string {
  return join(repoLocal(repoPath).runsDir, `${runId}.log`);
}

function globalRunLogPath(runId: string): string {
  return join(hostGlobal().logsDir, `${runId}.log`);
}

export async function ensureRunDirs(repoPath?: string): Promise<void> {
  const host = hostGlobal();
  await mkdir(host.dir, { recursive: true });
  await mkdir(host.runsDir, { recursive: true });
  await mkdir(host.logsDir, { recursive: true });
  if (repoPath) {
    await mkdir(repoLocal(repoPath).runsDir, { recursive: true });
  }
}

export async function writeRunSummary(repoPath: string, summary: RunSummary): Promise<void> {
  if (resolve(summary.repo_path) !== resolve(repoPath)) throw new Error("Run repository does not match.");
  withRuns(repoPath, (db) => db.transaction(() => {
    const existing = getRun(db, summary.id);
    if (existing && resolve(existing.repo_path) !== resolve(repoPath)) throw new Error("Run ID belongs to another repository.");
    putRun(db, summary);
  }).immediate());
}

export async function readRunSummary(repoPath: string, runId: string): Promise<RunSummary | null> {
  return withRuns(repoPath, (db) => {
    const run = getRun(db, runId);
    return run && resolve(run.repo_path) === resolve(repoPath) ? run : null;
  });
}

export async function readGlobalRunSummary(runId: string): Promise<RunSummary | null> {
  return withRuns(undefined, (db) => getRun(db, runId));
}

export async function patchRunSummary(
  repoPath: string,
  runId: string,
  patch: Partial<RunSummary>,
): Promise<RunSummary | null> {
  return withRuns(repoPath, (db) => db.transaction(() => {
    const current = getRun(db, runId);
    if (!current || resolve(current.repo_path) !== resolve(repoPath)) return null;
    if (patch.id && patch.id !== runId) throw new Error("Run identity cannot change.");
    if (patch.repo_path && resolve(patch.repo_path) !== resolve(repoPath)) throw new Error("Run repository cannot change.");
    return putRun(db, { ...current, ...patch });
  }).immediate());
}

export async function patchRunSummaryById(
  runId: string,
  patch: Partial<RunSummary>,
): Promise<RunSummary | null> {
  const current = await readGlobalRunSummary(runId);
  if (!current) return null;
  return patchRunSummary(current.repo_path, runId, patch);
}

export async function incrementRunCounters(
  repoPath: string,
  runId: string,
  delta: { updates?: number; status_writes?: number; last_status_at?: string },
): Promise<RunSummary | null> {
  return withRuns(repoPath, (db) => db.transaction(() => {
    const current = getRun(db, runId);
    if (!current || resolve(current.repo_path) !== resolve(repoPath)) return null;
    return putRun(db, {
      ...current,
      update_count: current.update_count + (delta.updates ?? 0),
      status_write_count: current.status_write_count + (delta.status_writes ?? 0),
      last_status_at: delta.last_status_at ?? current.last_status_at ?? null,
    });
  }).immediate());
}

export async function listProjectRuns(repoPath: string): Promise<RunSummary[]> {
  return withRuns(repoPath, (db) => db.query<{ body: string }, [string]>(
    "SELECT body FROM runs WHERE repo_path = ? ORDER BY started_at DESC, id",
  ).all(resolve(repoPath)).map((row) => migrateRunSummary(JSON.parse(row.body))));
}

export async function listGlobalRuns(): Promise<RunSummary[]> {
  return withRuns(undefined, (db) => db.query<{ body: string }, []>(
    "SELECT body FROM runs ORDER BY started_at DESC, id",
  ).all().map((row) => migrateRunSummary(JSON.parse(row.body))));
}

export async function writeRunLog(repoPath: string, runId: string, log: string): Promise<void> {
  await ensureRunDirs(repoPath);
  const safe = redactSensitiveText(log);
  await writeFile(repoRunLogPath(repoPath, runId), safe, "utf-8");
  await writeFile(globalRunLogPath(runId), safe, "utf-8");
}

export async function appendRunLog(repoPath: string, runId: string, chunk: string): Promise<void> {
  await ensureRunDirs(repoPath);
  const safe = redactSensitiveText(chunk);
  await appendFile(repoRunLogPath(repoPath, runId), safe, "utf-8");
  await appendFile(globalRunLogPath(runId), safe, "utf-8");
}

export async function readRunLogByRepo(repoPath: string, runId: string): Promise<string> {
  const file = repoRunLogPath(repoPath, runId);
  if (!existsSync(file)) return "";
  return redactSensitiveText(await readFile(file, "utf-8"));
}

export async function readRunLog(runId: string): Promise<string> {
  const file = globalRunLogPath(runId);
  if (!existsSync(file)) return "";
  return redactSensitiveText(await readFile(file, "utf-8"));
}

export async function writeHostState(state: HostState): Promise<void> {
  const host = hostGlobal();
  await mkdir(host.dir, { recursive: true });
  await writeFile(host.stateFile, JSON.stringify(HostStateSchema.parse(state), null, 2), "utf-8");
}

export async function readHostState(): Promise<HostState | null> {
  const file = hostGlobal().stateFile;
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf-8");
  return HostStateSchema.parse(JSON.parse(raw));
}
