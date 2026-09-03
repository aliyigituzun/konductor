import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HostStateSchema,
  RunSummarySchema,
  type HostState,
  type RunSummary,
} from "@konductor/schema";
import { hostGlobal, repoLocal } from "./paths.js";

function repoRunJsonPath(repoPath: string, runId: string): string {
  return join(repoLocal(repoPath).runsDir, `${runId}.json`);
}

function repoRunLogPath(repoPath: string, runId: string): string {
  return join(repoLocal(repoPath).runsDir, `${runId}.log`);
}

function globalRunJsonPath(runId: string): string {
  return join(hostGlobal().runsDir, `${runId}.json`);
}

function globalRunLogPath(runId: string): string {
  return join(hostGlobal().logsDir, `${runId}.log`);
}

export async function ensureRunDirs(repoPath?: string): Promise<void> {
  const host = hostGlobal();
  await mkdir(host.dir, { recursive: true });
  await mkdir(host.runsDir, { recursive: true });
  await mkdir(host.logsDir, { recursive: true });
  if (repoPath) {
    await mkdir(repoLocal(repoPath).runsDir, { recursive: true });
  }
}

export async function writeRunSummary(repoPath: string, summary: RunSummary): Promise<void> {
  const parsed = RunSummarySchema.parse(summary);
  await ensureRunDirs(repoPath);
  await writeFile(repoRunJsonPath(repoPath, parsed.id), JSON.stringify(parsed, null, 2), "utf-8");
  await writeFile(globalRunJsonPath(parsed.id), JSON.stringify(parsed, null, 2), "utf-8");
}

export async function readRunSummary(repoPath: string, runId: string): Promise<RunSummary | null> {
  const file = repoRunJsonPath(repoPath, runId);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf-8");
  return RunSummarySchema.parse(JSON.parse(raw));
}

export async function readGlobalRunSummary(runId: string): Promise<RunSummary | null> {
  const file = globalRunJsonPath(runId);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf-8");
  return RunSummarySchema.parse(JSON.parse(raw));
}

export async function patchRunSummary(
  repoPath: string,
  runId: string,
  patch: Partial<RunSummary>,
): Promise<RunSummary | null> {
  const current = (await readRunSummary(repoPath, runId)) ?? (await readGlobalRunSummary(runId));
  if (!current) return null;
  const next = RunSummarySchema.parse({ ...current, ...patch });
  await writeRunSummary(repoPath, next);
  return next;
}

export async function patchRunSummaryById(
  runId: string,
  patch: Partial<RunSummary>,
): Promise<RunSummary | null> {
  const current = await readGlobalRunSummary(runId);
  if (!current) return null;
  return patchRunSummary(current.repo_path, runId, patch);
}

export async function incrementRunCounters(
  repoPath: string,
  runId: string,
  delta: { updates?: number; status_writes?: number; last_status_at?: string },
): Promise<RunSummary | null> {
  const current = await readRunSummary(repoPath, runId);
  if (!current) return null;
  return patchRunSummary(repoPath, runId, {
    update_count: current.update_count + (delta.updates ?? 0),
    status_write_count: current.status_write_count + (delta.status_writes ?? 0),
    last_status_at: delta.last_status_at ?? current.last_status_at ?? null,
  });
}

export async function listProjectRuns(repoPath: string): Promise<RunSummary[]> {
  const dir = repoLocal(repoPath).runsDir;
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const runs: RunSummary[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      runs.push(RunSummarySchema.parse(JSON.parse(raw)));
    } catch {
      // Skip corrupted entries.
    }
  }
  return runs.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

export async function listGlobalRuns(): Promise<RunSummary[]> {
  const dir = hostGlobal().runsDir;
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const runs: RunSummary[] = [];
  for (const file of files) {
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      runs.push(RunSummarySchema.parse(JSON.parse(raw)));
    } catch {
      // Skip corrupted entries.
    }
  }
  return runs.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

export async function writeRunLog(repoPath: string, runId: string, log: string): Promise<void> {
  await ensureRunDirs(repoPath);
  await writeFile(repoRunLogPath(repoPath, runId), log, "utf-8");
  await writeFile(globalRunLogPath(runId), log, "utf-8");
}

export async function appendRunLog(repoPath: string, runId: string, chunk: string): Promise<void> {
  await ensureRunDirs(repoPath);
  await appendFile(repoRunLogPath(repoPath, runId), chunk, "utf-8");
  await appendFile(globalRunLogPath(runId), chunk, "utf-8");
}

export async function readRunLogByRepo(repoPath: string, runId: string): Promise<string> {
  const file = repoRunLogPath(repoPath, runId);
  if (!existsSync(file)) return "";
  return readFile(file, "utf-8");
}

export async function readRunLog(runId: string): Promise<string> {
  const file = globalRunLogPath(runId);
  if (!existsSync(file)) return "";
  return readFile(file, "utf-8");
}

export async function writeHostState(state: HostState): Promise<void> {
  const host = hostGlobal();
  await mkdir(host.dir, { recursive: true });
  await writeFile(host.stateFile, JSON.stringify(HostStateSchema.parse(state), null, 2), "utf-8");
}

export async function readHostState(): Promise<HostState | null> {
  const file = hostGlobal().stateFile;
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf-8");
  return HostStateSchema.parse(JSON.parse(raw));
}
