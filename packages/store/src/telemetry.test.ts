import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TelemetrySnapshot } from "@konductor/schema";
import { mutateTelemetry, readTelemetry, resetTelemetryUsage, writeTelemetry } from "./telemetry.js";
import { repoLocal } from "./paths.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function snapshot(): TelemetrySnapshot {
  return {
    schema_version: "0.2.0",
    captured_at: "2026-09-17T10:00:00.000Z",
    session_id: "session-1",
    project_id: "test-project",
    input_tokens: 1200,
    output_tokens: 340,
    cache_read_tokens: 80,
    cache_write_tokens: null,
    request_count: 12,
    top_tools: [{ name: "Read", count: 5, signal_status: "verified" }],
    top_files: [{ path: "src/index.ts", reads: 3, writes: 1, signal_status: "best_effort" }],
    context_window: 200000,
    peak_context_tokens: 42000,
    peak_context_percent: 0.21,
    compact_count: 2,
    cost_usd: 1.25,
    signal_availability: {
      input_tokens: "verified",
      output_tokens: "verified",
      cache_read_tokens: "verified",
      cache_write_tokens: "unavailable",
      request_count: "verified",
      cost_usd: "best_effort",
    },
  };
}

describe("resetTelemetryUsage", () => {
  test("imports once and commits merges and resets without reverting other fields", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "konductor-telemetry-import-"));
    dirs.push(cwd);
    const paths = repoLocal(cwd);
    await mkdir(paths.telemetryDir, { recursive: true });
    const legacy = JSON.stringify(snapshot());
    await writeFile(paths.latestTelemetry, legacy);
    expect((await readTelemetry(cwd))?.input_tokens).toBe(1200);
    await resetTelemetryUsage(cwd);
    await Promise.all(Array.from({ length: 10 }, () => mutateTelemetry(cwd, (current) => ({
      ...current!, input_tokens: (current?.input_tokens ?? 0) + 1,
    }))));
    expect((await readTelemetry(cwd))?.input_tokens).toBe(10);
    expect((await readTelemetry(cwd))?.top_tools).toEqual(snapshot().top_tools);
    expect(await readFile(paths.latestTelemetry, "utf-8")).toBe(legacy);
  });
  test("zeros available usage counters and preserves activity telemetry", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "konductor-telemetry-"));
    dirs.push(cwd);
    await writeTelemetry(cwd, snapshot());

    const reset = await resetTelemetryUsage(cwd);
    const saved = await readTelemetry(cwd);

    expect(reset?.input_tokens).toBe(0);
    expect(reset?.output_tokens).toBe(0);
    expect(reset?.cache_read_tokens).toBe(0);
    expect(reset?.cache_write_tokens).toBeNull();
    expect(reset?.request_count).toBe(0);
    expect(reset?.cost_usd).toBe(0);
    expect(saved?.top_tools).toEqual(snapshot().top_tools);
    expect(saved?.top_files).toEqual(snapshot().top_files);
    expect(saved?.peak_context_tokens).toBe(42000);
  });

  test("returns null when the project has no telemetry snapshot", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "konductor-telemetry-empty-"));
    dirs.push(cwd);
    expect(await resetTelemetryUsage(cwd)).toBeNull();
  });
});
