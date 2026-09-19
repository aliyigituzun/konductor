import type { Database } from "bun:sqlite";
import { withDatabase, importDocument, readDocument, writeDocument } from "./database.js";
import { repoLocal } from "./paths.js";
import { TelemetrySnapshotSchema, type TelemetrySnapshot } from "@konductor/schema";

export async function readTelemetry(cwd: string): Promise<TelemetrySnapshot | null> {
  return withTelemetry(cwd, (db) => readDocument(db, "telemetry", TelemetrySnapshotSchema.parse));
}

function withTelemetry<T>(cwd: string, work: (db: Database) => T): T {
  const paths = repoLocal(cwd);
  return withDatabase(paths.database, (db) => {
    importDocument(db, "telemetry", paths.latestTelemetry, TelemetrySnapshotSchema.parse);
    return work(db);
  });
}

/** Merge against the latest committed snapshot while holding the SQLite write lock. */
export async function mutateTelemetry(
  cwd: string,
  mutate: (current: TelemetrySnapshot | null) => TelemetrySnapshot | null,
): Promise<TelemetrySnapshot | null> {
  return withTelemetry(cwd, (db) => db.transaction(() => {
    const next = mutate(readDocument(db, "telemetry", TelemetrySnapshotSchema.parse));
    if (next === null) return null;
    const parsed = TelemetrySnapshotSchema.parse(next);
    writeDocument(db, "telemetry", parsed);
    return parsed;
  }).immediate());
}

export async function writeTelemetry(
  cwd: string,
  snapshot: TelemetrySnapshot
): Promise<void> {
  await mutateTelemetry(cwd, () => snapshot);
}

/**
 * Reset the counters shown in the Token Usage panel without discarding activity or
 * context telemetry. Unavailable signals stay null rather than becoming fake zeros.
 */
export async function resetTelemetryUsage(cwd: string): Promise<TelemetrySnapshot | null> {
  return mutateTelemetry(cwd, (current) => {
    if (!current) return null;

    const reset = (value: number | null): number | null => value === null ? null : 0;
    return {
      ...current,
      captured_at: new Date().toISOString(),
      input_tokens: reset(current.input_tokens),
      output_tokens: reset(current.output_tokens),
      cache_read_tokens: reset(current.cache_read_tokens),
      cache_write_tokens: reset(current.cache_write_tokens),
      request_count: reset(current.request_count),
      cost_usd: reset(current.cost_usd),
    };
  });
}
