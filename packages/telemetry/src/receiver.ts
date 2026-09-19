#!/usr/bin/env bun
/**
 * Konductor OTLP receiver — run as a background daemon by `konductor mcp serve`
 * or `konductor telemetry start`.
 *
 * Accepts OTLP/HTTP POST pushes from Claude Code and accumulates telemetry
 * into the project's SQLite state. Only collects data
 * when started inside a directory that has .konductor/ initialized.
 *
 * Environment:
 *   KONDUCTOR_PROJECT_DIR  — absolute path to the project root (required)
 *   OTEL_RECEIVER_PORT     — port to listen on (default: 4318)
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mutateTelemetry } from "@konductor/store";
import { mergeSnapshot, type OtlpData } from "./adapter.js";

const PORT = parseInt(process.env["OTEL_RECEIVER_PORT"] ?? "4318", 10);
const PROJECT_DIR = process.env["KONDUCTOR_PROJECT_DIR"];
const RUN_ID = process.env["KONDUCTOR_RUN_ID"] ?? null;
const PROFILE_ID = process.env["KONDUCTOR_PROFILE_ID"] ?? null;
const RUN_SOURCE = (process.env["KONDUCTOR_RUN_SOURCE"] as "dashboard" | "cli" | undefined) ?? undefined;

if (!PROJECT_DIR) {
  process.stderr.write("[konductor receiver] KONDUCTOR_PROJECT_DIR not set — exiting\n");
  process.exit(1);
}

const KONDUCTOR_DIR = join(PROJECT_DIR, ".konductor");
if (!existsSync(KONDUCTOR_DIR)) {
  process.stderr.write(
    `[konductor receiver] No .konductor/ in ${PROJECT_DIR} — exiting\n`
  );
  process.exit(1);
}

const CONFIG_PATH = join(PROJECT_DIR, "konductor.config.json");

let projectId = "unknown";
try {
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf-8")) as { project_id?: string };
  if (cfg.project_id) projectId = cfg.project_id;
} catch {
  process.stderr.write("[konductor receiver] Could not read config — using 'unknown' as project_id\n");
}

process.stderr.write(
  `[konductor receiver] ready  project=${projectId}  port=${PORT}\n`
);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    // OTLP HTTP only uses POST; respond OK to anything else (e.g. health checks)
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ partialSuccess: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = (await req.json()) as OtlpData;

      await mutateTelemetry(PROJECT_DIR!, (existing) => {
        const merged = mergeSnapshot(existing, body, projectId);
        if (RUN_ID) merged.run_id = RUN_ID;
        if (PROFILE_ID) merged.profile_id = PROFILE_ID;
        if (RUN_SOURCE) merged.source = RUN_SOURCE;
        return merged;
      });
    } catch (err) {
      process.stderr.write(`[konductor receiver] failed to process request: ${err}\n`);
      return new Response("Failed to persist telemetry", { status: 503 });
    }

    return new Response(JSON.stringify({ partialSuccess: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  },
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});

// Keep stdout clean so the daemon doesn't spam logs
process.stderr.write(`[konductor receiver] listening on :${PORT}\n`);
