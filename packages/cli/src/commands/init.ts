import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  repoLocal,
  configPath,
  upsertProject,
  writeConfig,
  defaultPromptPack,
  reconcileInternalProfileTokens,
} from "@konductor/store";
import type { KonductorConfig } from "@konductor/schema";
import { resolveAdapter, resolveAdapterBinary, setupAdapter } from "@konductor/agents";
import { fmt, header } from "../ui/format.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function detectProjectName(cwd: string): Promise<string> {
  // Try package.json first
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const raw = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string };
      if (pkg.name) return pkg.name.replace(/^@[^/]+\//, "");
    } catch {
      // fallthrough
    }
  }
  // Fall back to folder name
  return basename(cwd);
}

export async function runInit(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const isEmpty = args.includes("--empty");

  console.log(header("konductor init"));

  const configFile = configPath(cwd);
  if (existsSync(configFile)) {
    console.log(`${fmt.yellow("!")} konductor.config.json already exists.`);
    console.log(`  Run ${fmt.bold("konductor doctor")} to verify your setup.\n`);
    return;
  }

  let projectName: string;
  let projectId: string;

  if (isEmpty) {
    projectName = basename(cwd);
    projectId = slugify(projectName);
    console.log(`${fmt.dim("mode:")} empty (skipping inference)`);
  } else {
    projectName = await detectProjectName(cwd);
    projectId = slugify(projectName);
    console.log(`${fmt.dim("detected:")} ${fmt.bold(projectName)} (${projectId})`);
  }

  const paths = repoLocal(cwd);
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.telemetryDir, { recursive: true });
  await mkdir(paths.historyDir, { recursive: true });
  await mkdir(paths.backupsDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });

  const preferredAdapters = ["pi", "opencode", "codex", "claude_code", "gemini_cli"];
  const requestedAdapter = args.includes("--adapter") ? args[args.indexOf("--adapter") + 1] : undefined;
  const adapterId = requestedAdapter ?? (await (async () => {
    for (const candidate of preferredAdapters) {
      try {
        const adapter = await resolveAdapter(candidate, cwd);
        if (resolveAdapterBinary(adapter)) return candidate;
      } catch { /* try the next built-in adapter */ }
    }
    return "pi";
  })());
  const selectedAdapter = await resolveAdapter(adapterId, cwd);
  const selectedProvider = selectedAdapter.providers[0]!.id;
  const profileId = `${adapterId}-default`;
  const defaultProfile = {
    id: profileId,
    title: selectedAdapter.title,
    adapter: adapterId,
    provider: selectedProvider,
    args: [],
    worktree: false,
    default_mcp: true,
    default_working_dir: "project_root" as const,
    default_env: {},
    telemetry: selectedAdapter.telemetry.kind === "otel_env"
      ? { provider: "opentelemetry", mode: "collector" }
      : undefined,
  };

  const config: KonductorConfig = {
    schema_version: "0.3.0",
    project_id: projectId,
    project_name: projectName,
    repo_root: ".",
    default_branch: "main",
    agents: {
      default_profile: profileId,
      profiles: [defaultProfile],
      prompt_packs: [defaultPromptPack()],
    },
    dashboard: { mode: "local" },
    telemetry: { provider: "opentelemetry", mode: "collector" },
    host: { port: 4096, log_retention: 50, auto_start: false, tmux_session: "konductor" },
  };
  await writeConfig(cwd, config);

  const now = new Date().toISOString();
  const seed = {
    schema_version: "0.2.0",
    project: { id: projectId, name: projectName },
    agent: { kind: "claude_code", session_id: null },
    report: { reported_at: now },
    status: {
      state: "todo",
      summary: "Project initialized. Awaiting first status update.",
      current_phase_id: null,
    },
    phases: [],
    issues: {
      blockers: [],
      decisions_needed: [],
      external_dependencies: [],
      risks: [],
    },
    next_actions: [
      "Configure project phases in konductor.config.json",
      "Run `konductor host start` to enable dashboard-launched Claude runs",
      "Run `konductor mcp serve` to debug MCP writes manually if needed",
    ],
    links: { task_url: null, pr_url: null, issue_urls: [] },
    run: undefined,
  };
  await writeFile(paths.currentStatus, JSON.stringify(seed, null, 2), "utf-8");

  await upsertProject({
    id: projectId,
    name: projectName,
    repo_path: cwd,
    last_sync: null,
    status_path: paths.currentStatus,
    telemetry_path: paths.database,
    history_dir: paths.historyDir,
    initialized_at: now,
    default_profile: profileId,
    active_run_count: 0,
    last_agent_activity_at: null,
  });
  await reconcileInternalProfileTokens(projectId, config.agents!.profiles);

  // Harness preparation is intentionally non-fatal: the repository and registry
  // must remain usable even when a machine-level adapter directory is unavailable.
  try {
    if (resolveAdapterBinary(selectedAdapter)) {
      const adapterSetup = await setupAdapter(selectedAdapter);
      console.log(
        `${fmt.green("✓")} ${selectedAdapter.title} integration ${adapterSetup.changed ? "written" : "ready"} at ${adapterSetup.directory}`,
      );
    } else {
      console.log(
        `${fmt.yellow("!")} ${selectedAdapter.title} is not installed; run ` +
          `${fmt.bold(`konductor adapters setup ${selectedAdapter.id}`)} to approve an isolated installation.`,
      );
    }
  } catch (error) {
    console.log(
      `${fmt.yellow("!")} Project initialized, but ${selectedAdapter.title} setup was deferred: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    console.log(`  Run ${fmt.bold(`konductor adapters setup ${selectedAdapter.id}`)} to retry.`);
  }

  console.log(`\n${fmt.green("✓")} Initialized ${fmt.bold(projectName)}\n`);
  console.log(`  ${fmt.dim("config:")}    konductor.config.json`);
  console.log(`  ${fmt.dim("status:")}    .konductor/status/current.json`);
  console.log(`  ${fmt.dim("registry:")}  ~/.konductor/state.sqlite`);
  console.log(`  ${fmt.dim("harnesses:")} ~/.konductor/harnesses/`);
  console.log(`  ${fmt.dim("runs:")}      .konductor/runs/`);
  console.log(`\n${fmt.dim("Next steps:")}`);
  console.log(`  ${fmt.bold("konductor host start")}  — start the local agent host`);
  console.log(`  ${fmt.bold("konductor agent start")} — launch a coding agent on a task`);
  console.log(`  ${fmt.bold("konductor doctor")}       — verify your setup`);
  console.log(`  ${fmt.bold("konductor dashboard")}    — open the local dashboard\n`);
}
