import { join } from "node:path";
import { homedir } from "node:os";

export const GLOBAL_DIR = join(homedir(), ".konductor");
export const GLOBAL_REGISTRY = join(GLOBAL_DIR, "registry.json");
export const RECEIVER_PID = join(GLOBAL_DIR, "receiver.pid");
export const RECEIVER_LOG = join(GLOBAL_DIR, "receiver.log");
export const HOST_DIR = join(GLOBAL_DIR, "host");
export const HOST_PID = join(HOST_DIR, "host.pid");
export const HOST_LOG = join(HOST_DIR, "host.log");
export const HOST_STATE = join(HOST_DIR, "state.json");
export const HOST_RUNS_DIR = join(HOST_DIR, "runs");
export const HOST_LOGS_DIR = join(HOST_DIR, "logs");

export function repoLocal(cwd: string) {
  const dir = join(cwd, ".konductor");
  return {
    dir,
    statusDir: join(dir, "status"),
    telemetryDir: join(dir, "telemetry"),
    historyDir: join(dir, "history"),
    backupsDir: join(dir, "backups"),
    runsDir: join(dir, "runs"),
    tokensFile: join(dir, "tokens.json"),
    currentStatus: join(dir, "status", "current.json"),
    latestTelemetry: join(dir, "telemetry", "latest.json"),
    updatesFile: join(dir, "updates.jsonl"),
  };
}

export function configPath(cwd: string) {
  return join(cwd, "konductor.config.json");
}

export function globalRegistry() {
  return GLOBAL_REGISTRY;
}

export function hostGlobal() {
  return {
    dir: HOST_DIR,
    pidFile: HOST_PID,
    logFile: HOST_LOG,
    stateFile: HOST_STATE,
    runsDir: HOST_RUNS_DIR,
    logsDir: HOST_LOGS_DIR,
  };
}
