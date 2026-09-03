import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendHistory, trimHistory, readHistory } from "./history.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "konductor-hist-"));
  await mkdir(join(tempDir, "history"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true });
});

function makeEntry(i: number) {
  const d = new Date(2026, 0, 1 + i);
  return {
    schema_version: "0.1.0" as const,
    synced_at: d.toISOString(),
    project_id: "test",
    status_snapshot_path: `/tmp/test/.konductor/status/current.json`,
    telemetry_snapshot_path: null,
    summary: `Sync ${i}`,
  };
}

test("appendHistory writes a file", async () => {
  const histDir = join(tempDir, "history");
  const entry = makeEntry(0);
  await appendHistory(histDir, entry);
  const entries = await readHistory(histDir);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.project_id).toBe("test");
});

test("trimHistory caps at 30 entries", async () => {
  const histDir = join(tempDir, "history");
  for (let i = 0; i < 35; i++) {
    await appendHistory(histDir, makeEntry(i));
  }
  const entries = await readHistory(histDir);
  expect(entries.length).toBeLessThanOrEqual(30);
});

test("trimHistory keeps newest entries", async () => {
  const histDir = join(tempDir, "history");
  for (let i = 0; i < 35; i++) {
    await appendHistory(histDir, makeEntry(i));
  }
  const entries = await readHistory(histDir);
  // All remaining entries should be the later ones (indices 5-34)
  expect(entries[0]?.synced_at).toContain("2026-01-06");
});
