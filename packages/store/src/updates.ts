import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import { repoLocal } from "./paths.js";
import { withDatabase, importOnce } from "./database.js";
import { UpdateEntrySchema, type UpdateEntry } from "@konductor/schema";
import { redactSensitiveText } from "./redaction.js";
import { inferUpdateTags } from "./update-tags.js";

function safeUpdate(entry: UpdateEntry): UpdateEntry {
  return { ...entry, message: redactSensitiveText(entry.message) };
}

function withUpdates<T>(cwd: string, work: (db: Database) => T): T {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importOnce(db, paths.updatesFile, () => {
      if (!existsSync(paths.updatesFile)) return;
      for (const line of readFileSync(paths.updatesFile, "utf-8").split("\n").filter(Boolean)) {
        const entry = safeUpdate(UpdateEntrySchema.parse(JSON.parse(line)));
        db.query("INSERT OR IGNORE INTO updates (id, body) VALUES (?, ?)").run(entry.id, JSON.stringify(entry));
      }
    });
    return work(db);
  });
}

export async function appendUpdate(
  cwd: string,
  fields: Omit<UpdateEntry, "id" | "at">
): Promise<UpdateEntry> {
  const entry: UpdateEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...fields,
    ...inferUpdateTags(fields),
  };
  const safe = safeUpdate(UpdateEntrySchema.parse(entry));
  withUpdates(cwd, (db) => db.query("INSERT INTO updates (id, body) VALUES (?, ?)").run(safe.id, JSON.stringify(safe)));
  return safe;
}

export async function readUpdates(cwd: string): Promise<UpdateEntry[]> {
  return withUpdates(cwd, (db) => db.query<{ body: string }, []>("SELECT body FROM updates ORDER BY sequence").all()
    .map((row) => safeUpdate(UpdateEntrySchema.parse(JSON.parse(row.body)))));
}
