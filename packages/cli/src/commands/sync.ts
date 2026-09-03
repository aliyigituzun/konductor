import { existsSync } from "node:fs";
import {
  readStatus,
  readTelemetry,
  repoLocal,
  upsertProject,
  getProject,
  appendHistory,
  readConfig,
  listProjectRuns,
} from "@konductor/store";
import { fmt, header } from "../ui/format.js";

export async function runSync(_args: string[]): Promise<void> {
  const cwd = process.cwd();

  console.log(header("konductor sync"));

  const snap = await readStatus(cwd);
  if (!snap) {
    console.error(`${fmt.red("✗")} No status found. Run ${fmt.bold("konductor init")} first.`);
    process.exit(1);
  }

  const config = await readConfig(cwd);
  if (!config) {
    console.error(`${fmt.red("✗")} No konductor.config.json found.`);
    process.exit(1);
  }
  const projectId = config.project_id;

  const paths = repoLocal(cwd);
  const now = new Date().toISOString();

  // Read telemetry from latest.json — the background receiver keeps this current.
  // If no receiver has run yet, telemetry will simply be absent.
  const telSnap = await readTelemetry(cwd);
  const telemetryPath = telSnap ? paths.latestTelemetry : null;
  if (telSnap) {
    console.log(`${fmt.green("✓")} Telemetry snapshot found (${telSnap.captured_at})`);
  } else {
    console.log(
      `${fmt.yellow("!")} No telemetry yet — run ${fmt.bold("konductor telemetry start")} before your Claude Code session`
    );
  }

  // Write history entry
  const historyEntry = {
    schema_version: "0.2.0" as const,
    synced_at: now,
    project_id: projectId,
    status_snapshot_path: paths.currentStatus,
    telemetry_snapshot_path: telemetryPath,
    summary: snap.status.summary,
  };
  await appendHistory(paths.historyDir, historyEntry);
  console.log(`${fmt.green("✓")} History entry written`);

  // Update registry last_sync
  const existing = await getProject(projectId);
  if (existing) {
    const runs = await listProjectRuns(cwd);
    await upsertProject({
      ...existing,
      last_sync: now,
      default_profile: config.agents?.default_profile ?? existing.default_profile ?? null,
      active_run_count: runs.filter((run) => run.status === "running" || run.status === "queued").length,
      last_agent_activity_at: runs[0]?.started_at ?? existing.last_agent_activity_at ?? null,
    });
    console.log(`${fmt.green("✓")} Registry updated`);
  }

  console.log(`\n${fmt.green("✓")} Sync complete.\n`);
}
