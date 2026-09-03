import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { repoLocal } from "./paths.js";
import { StatusSnapshotSchema, type StatusSnapshot } from "@konductor/schema";

export async function readStatus(cwd: string): Promise<StatusSnapshot | null> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.currentStatus)) return null;
  const raw = await readFile(paths.currentStatus, "utf-8");
  return StatusSnapshotSchema.parse(JSON.parse(raw));
}

export async function writeStatus(
  cwd: string,
  snapshot: StatusSnapshot
): Promise<void> {
  const paths = repoLocal(cwd);
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.backupsDir, { recursive: true });

  // Backup previous if exists
  if (existsSync(paths.currentStatus)) {
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    const backupFile = join(paths.backupsDir, `current-${ts}.json`);
    await copyFile(paths.currentStatus, backupFile);
  }

  await writeFile(paths.currentStatus, JSON.stringify(snapshot, null, 2), "utf-8");
}

export async function readRawStatus(cwd: string): Promise<string | null> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.currentStatus)) return null;
  return readFile(paths.currentStatus, "utf-8");
}
