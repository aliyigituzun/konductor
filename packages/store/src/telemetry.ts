import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { repoLocal } from "./paths.js";
import { TelemetrySnapshotSchema, type TelemetrySnapshot } from "@konductor/schema";

export async function readTelemetry(cwd: string): Promise<TelemetrySnapshot | null> {
  const paths = repoLocal(cwd);
  if (!existsSync(paths.latestTelemetry)) return null;
  const raw = await readFile(paths.latestTelemetry, "utf-8");
  return TelemetrySnapshotSchema.parse(JSON.parse(raw));
}

export async function writeTelemetry(
  cwd: string,
  snapshot: TelemetrySnapshot
): Promise<void> {
  const paths = repoLocal(cwd);
  await mkdir(paths.telemetryDir, { recursive: true });
  await writeFile(paths.latestTelemetry, JSON.stringify(snapshot, null, 2), "utf-8");
}
