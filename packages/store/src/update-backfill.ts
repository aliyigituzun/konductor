import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { StatusSnapshotSchema, UpdateEntrySchema, type StatusSnapshot, type UpdateEntry } from "@konductor/schema";
import { diffStatusSnapshots } from "./status-diff.js";
import { inferUpdateTags, MIGRATION_AGENT } from "./update-tags.js";

const DEDUPE_WINDOW_MS = 120_000;

/** `current-2026-05-07T21-13-54-401Z.json` → ISO timestamp, or null for other files. */
function backupTimestamp(fileName: string): string | null {
  const match = /^current-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/.exec(fileName);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function parseSnapshot(path: string): StatusSnapshot | null {
  try {
    const parsed = StatusSnapshotSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Quoted names in a message, used to match a reconstructed event to a logged one. */
function quoted(message: string): string[] {
  return [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
}

function alreadyLogged(existing: UpdateEntry[], draft: UpdateEntry): boolean {
  const at = new Date(draft.at).getTime();
  const names = quoted(draft.message);
  return existing.some((entry) => {
    if (entry.subject !== draft.subject) return false;
    if (Math.abs(new Date(entry.at).getTime() - at) > DEDUPE_WINDOW_MS) return false;
    if (draft.feature_item_id && entry.feature_item_id === draft.feature_item_id) return true;
    return names.some((name) => entry.message.includes(`"${name}"`));
  });
}

/**
 * Fill missing subject/action on every stored update, then reconstruct feature
 * events that predate per-feature logging from the status snapshot backups that
 * `writeStatus` keeps. A backup is named for the moment it was replaced, so the
 * later file's timestamp is when the change it reveals actually landed.
 */
export function backfillUpdates(db: Database, repoPath: string): void {
  const rows = db.query<{ id: string; body: string }, []>("SELECT id, body FROM updates ORDER BY sequence").all();
  const write = db.query("UPDATE updates SET body = ? WHERE id = ?");
  const existing: UpdateEntry[] = [];
  for (const row of rows) {
    const parsed = UpdateEntrySchema.safeParse(JSON.parse(row.body));
    if (!parsed.success) continue;
    const tags = inferUpdateTags(parsed.data);
    const entry = { ...parsed.data, ...tags };
    if (tags.subject || tags.action) write.run(JSON.stringify(entry), row.id);
    existing.push(entry);
  }

  const backupsDir = join(repoPath, ".konductor", "backups");
  if (!existsSync(backupsDir)) return;
  const history = readdirSync(backupsDir)
    .map((name) => ({ at: backupTimestamp(name), path: join(backupsDir, name) }))
    .filter((file): file is { at: string; path: string } => file.at !== null)
    .sort((a, b) => a.at.localeCompare(b.at));
  const current = join(repoPath, ".konductor", "status", "current.json");
  if (existsSync(current)) history.push({ at: new Date().toISOString(), path: current });
  if (history.length < 2) return;

  const insert = db.query("INSERT INTO updates (id, body) VALUES (?, ?)");
  let previous = parseSnapshot(history[0]!.path);
  for (const file of history.slice(1)) {
    const next = parseSnapshot(file.path);
    if (!next) continue;
    for (const draft of diffStatusSnapshots(previous, next)) {
      const entry: UpdateEntry = { id: randomUUID(), at: file.at, agent: MIGRATION_AGENT, ...draft };
      if (alreadyLogged(existing, entry)) continue;
      insert.run(entry.id, JSON.stringify(entry));
      existing.push(entry);
    }
    previous = next;
  }
}
