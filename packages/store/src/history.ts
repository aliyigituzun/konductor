import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { SyncHistoryEntrySchema, type SyncHistoryEntry } from "@konductor/schema";

const MAX_HISTORY = 30;

export async function appendHistory(
  historyDir: string,
  entry: SyncHistoryEntry
): Promise<void> {
  const filename = entry.synced_at.replace(/:/g, "-").replace(/\./g, "-") + ".json";
  const filepath = join(historyDir, filename);
  await writeFile(filepath, JSON.stringify(entry, null, 2), "utf-8");
  await trimHistory(historyDir, MAX_HISTORY);
}

export async function trimHistory(
  historyDir: string,
  max: number = MAX_HISTORY
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch {
    return;
  }
  const jsonFiles = files
    .filter((f) => f.endsWith(".json"))
    .sort(); // ISO date filenames sort lexicographically = chronologically

  if (jsonFiles.length <= max) return;

  const toDelete = jsonFiles.slice(0, jsonFiles.length - max);
  await Promise.all(toDelete.map((f) => unlink(join(historyDir, f))));
}

export async function readHistory(historyDir: string): Promise<SyncHistoryEntry[]> {
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch {
    return [];
  }
  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
  const entries: SyncHistoryEntry[] = [];
  for (const f of jsonFiles) {
    try {
      const raw = await readFile(join(historyDir, f), "utf-8");
      entries.push(SyncHistoryEntrySchema.parse(JSON.parse(raw)));
    } catch {
      // skip corrupted entries
    }
  }
  return entries;
}
