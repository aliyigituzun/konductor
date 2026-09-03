import { type ProjectImportantPaths } from "@konductor/schema";
import { globalRegistry, hostGlobal, repoLocal, configPath } from "./paths.js";

export function importantProjectPaths(repoPath: string): ProjectImportantPaths {
  const repo = repoLocal(repoPath);
  const host = hostGlobal();
  return {
    repo_root: repoPath,
    config_path: configPath(repoPath),
    konductor_dir: repo.dir,
    tokens_path: repo.tokensFile,
    status_path: repo.currentStatus,
    updates_path: repo.updatesFile,
    telemetry_path: repo.latestTelemetry,
    history_dir: repo.historyDir,
    runs_dir: repo.runsDir,
    registry_path: globalRegistry(),
    host_dir: host.dir,
  };
}
