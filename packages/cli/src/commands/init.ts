import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import {
  repoLocal,
  configPath,
  upsertProject,
  writeConfig,
  defaultClaudeProfile,
  defaultPromptPack,
  ensureProjectMcpConfig,
  DEFAULT_OTEL_ENV,
} from "@konductor/store";
import type { KonductorConfig } from "@konductor/schema";
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

async function ensureClaudeOtelConfig(cwd: string): Promise<boolean> {
  const claudeDir = join(cwd, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // unparseable — overwrite
    }
  }

  const existingEnv = (existing["env"] as Record<string, string> | undefined) ?? {};
  const alreadySet = Object.keys(DEFAULT_OTEL_ENV).every((k) => k in existingEnv);
  if (alreadySet) return false;

  existing["env"] = { ...DEFAULT_OTEL_ENV, ...existingEnv };
  await mkdir(claudeDir, { recursive: true });
  await writeFile(settingsPath, JSON.stringify(existing, null, 2), "utf-8");
  return true;
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

  // Create directory structure
  const paths = repoLocal(cwd);
  await mkdir(paths.statusDir, { recursive: true });
  await mkdir(paths.telemetryDir, { recursive: true });
  await mkdir(paths.historyDir, { recursive: true });
  await mkdir(paths.backupsDir, { recursive: true });
  await mkdir(paths.runsDir, { recursive: true });

  // Wire OTEL env vars into .claude/settings.local.json
  const wroteOtel = await ensureClaudeOtelConfig(cwd);
  if (wroteOtel) {
    console.log(`${fmt.green("✓")} OTEL telemetry vars written to .claude/settings.local.json`);
  }

  // Write konductor.config.json
  const config: KonductorConfig = {
    schema_version: "0.3.0",
    project_id: projectId,
    project_name: projectName,
    repo_root: ".",
    default_branch: "main",
    agent: { primary: "claude_code" },
    agents: {
      default_profile: "claude-default",
      profiles: [defaultClaudeProfile()],
      prompt_packs: [defaultPromptPack()],
    },
    dashboard: { mode: "local" },
    telemetry: { provider: "opentelemetry", mode: "collector" },
    host: { port: 4096, log_retention: 50, auto_start: false, tmux_session: "konductor" },
  };
  await writeConfig(cwd, config);
  const wroteMcp = await ensureProjectMcpConfig(cwd);
  if (wroteMcp) {
    console.log(`${fmt.green("✓")} Project MCP config written to .mcp.json`);
  }

  // Write seed current.json
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

  // Register in global registry
  await upsertProject({
    id: projectId,
    name: projectName,
    repo_path: cwd,
    last_sync: null,
    status_path: paths.currentStatus,
    telemetry_path: paths.latestTelemetry,
    history_dir: paths.historyDir,
    initialized_at: now,
    default_profile: "claude-default",
    active_run_count: 0,
    last_agent_activity_at: null,
  });

  console.log(`\n${fmt.green("✓")} Initialized ${fmt.bold(projectName)}\n`);
  console.log(`  ${fmt.dim("config:")}    konductor.config.json`);
  console.log(`  ${fmt.dim("status:")}    .konductor/status/current.json`);
  console.log(`  ${fmt.dim("registry:")}  ~/.konductor/registry.json`);
  console.log(`  ${fmt.dim("telemetry:")} .claude/settings.local.json (OTEL vars)`);
  console.log(`  ${fmt.dim("runs:")}      .konductor/runs/`);
  console.log(`\n${fmt.dim("Next steps:")}`);
  console.log(`  ${fmt.bold("konductor host start")}  — start the local agent host`);
  console.log(`  ${fmt.bold("konductor agent start")} — launch a coding agent on a task`);
  console.log(`  ${fmt.bold("konductor doctor")}       — verify your setup`);
  console.log(`  ${fmt.bold("konductor dashboard")}    — open the local dashboard\n`);
}
