import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { repoLocal } from "./paths.js";
import { UpdateEntrySchema, type UpdateEntry } from "@konductor/schema";

export async function appendUpdate(
  cwd: string,
  fields: Omit<UpdateEntry, "id" | "at">
): Promise<UpdateEntry> {
  const paths = repoLocal(cwd);
  await mkdir(paths.dir, { recursive: true });
  const entry: UpdateEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...fields,
  };
  UpdateEntrySchema.parse(entry);
  await appendFile(paths.updatesFile, JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

export async function readUpdates(cwd: string): Promise<UpdateEntry[]> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.updatesFile)) return [];
  const raw = await readFile(paths.updatesFile, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => UpdateEntrySchema.parse(JSON.parse(line)));
}
