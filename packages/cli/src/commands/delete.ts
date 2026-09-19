import { rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { configPath, repoLocal, readRegistry, removeProject } from "@konductor/store";
import { fmt, header } from "../ui/format.js";

const OTEL_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_LOGS_EXPORT_INTERVAL",
];

async function cleanOtelConfig(repoPath: string, dryRun: boolean): Promise<boolean> {
  const settingsPath = join(repoPath, ".claude", "settings.local.json");
  if (!existsSync(settingsPath)) return false;
  try {
    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings["env"] as Record<string, string> | undefined;
    if (!env) return false;
    const toRemove = OTEL_KEYS.filter((k) => k in env);
    if (toRemove.length === 0) return false;
    if (!dryRun) {
      for (const k of toRemove) delete env[k];
      if (Object.keys(env).length === 0) delete settings["env"];
      await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    }
    return true;
  } catch {
    return false;
  }
}

async function promptConfirm(question: string): Promise<boolean> {
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      const ans = String(chunk).trim().toLowerCase();
      resolve(ans === "y" || ans === "yes");
    });
  });
}

export async function runDelete(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");
  const dryRun = args.includes("--dry-run");
  const keepLocal = args.includes("--keep-local");

  const projectFlagIdx = args.findIndex((a) => a === "--project" || a === "-p");
  const explicitId = projectFlagIdx >= 0 ? args[projectFlagIdx + 1] : undefined;

  console.log(header("konductor delete"));

  let projectId: string;
  let repoPath: string;
  let projectName: string;

  if (explicitId) {
    const registry = await readRegistry();
    const entry = registry.projects.find((p) => p.id === explicitId);
    if (!entry) {
      console.error(`${fmt.red("✗")} Project "${explicitId}" not found in registry.`);
      if (registry.projects.length > 0) {
        console.error(`\n  Known projects:`);
        for (const p of registry.projects) {
          console.error(`    ${fmt.bold(p.id)}  ${fmt.dim(p.name)}`);
        }
      }
      process.exit(1);
    }
    projectId = entry.id;
    projectName = entry.name;
    repoPath = entry.repo_path;
  } else {
    const cfgFile = configPath(cwd);
    if (!existsSync(cfgFile)) {
      console.error(`${fmt.red("✗")} No konductor.config.json found in current directory.`);
      const registry = await readRegistry();
      if (registry.projects.length > 0) {
        console.error(`\n  Use ${fmt.bold("--project <id>")} to delete by ID. Known projects:`);
        for (const p of registry.projects) {
          console.error(`    ${fmt.bold(p.id)}  ${fmt.dim(p.name)}  ${fmt.gray(p.repo_path)}`);
        }
      } else {
        console.error(`  Use ${fmt.bold("--project <id>")} to delete by ID.`);
      }
      process.exit(1);
    }
    const raw = await readFile(cfgFile, "utf-8");
    const cfg = JSON.parse(raw) as { project_id: string; project_name: string };
    projectId = cfg.project_id;
    projectName = cfg.project_name;
    repoPath = cwd;
  }

  const paths = repoLocal(repoPath);
  const cfgFile = configPath(repoPath);
  const mcpFile = join(repoPath, ".mcp.json");
  const localDirExists = existsSync(paths.dir);
  const cfgExists = existsSync(cfgFile);
  const mcpExists = existsSync(mcpFile);
  const otelExists = existsSync(join(repoPath, ".claude", "settings.local.json"));

  console.log(`${fmt.bold("Project:")} ${projectName} ${fmt.dim(`(${projectId})`)}`);
  console.log(`${fmt.bold("Repo:")}    ${fmt.dim(repoPath)}\n`);
  console.log(fmt.bold("Will remove:"));
  console.log(`  ${fmt.green("✓")}  registry entry  ${fmt.dim("host SQLite registry")}`);
  if (!keepLocal) {
    if (cfgExists) console.log(`  ${fmt.green("✓")}  config file     ${fmt.dim(cfgFile)}`);
    if (mcpExists) console.log(`  ${fmt.green("✓")}  MCP config      ${fmt.dim(mcpFile)}`);
    if (localDirExists) console.log(`  ${fmt.green("✓")}  data directory  ${fmt.dim(paths.dir)}`);
    if (otelExists) console.log(`  ${fmt.green("✓")}  OTEL env vars   ${fmt.dim(join(repoPath, ".claude", "settings.local.json"))}`);
  } else {
    console.log(`  ${fmt.dim("(--keep-local: local files will not be removed)")}`);
  }
  console.log();

  if (dryRun) {
    console.log(`${fmt.yellow("!")} Dry run — nothing was deleted.\n`);
    return;
  }

  if (!force) {
    const confirmed = await promptConfirm(
      `${fmt.yellow("?")} Delete ${fmt.bold(projectName)}? This cannot be undone. [y/N] `
    );
    console.log();
    if (!confirmed) {
      console.log(`${fmt.dim("Cancelled.")}\n`);
      return;
    }
  }

  await removeProject(projectId);
  console.log(`${fmt.green("✓")} Removed from registry`);

  if (!keepLocal) {
    if (localDirExists) {
      await rm(paths.dir, { recursive: true, force: true });
      console.log(`${fmt.green("✓")} Deleted .konductor/`);
    }
    if (cfgExists) {
      await rm(cfgFile, { force: true });
      console.log(`${fmt.green("✓")} Deleted konductor.config.json`);
    }
    if (mcpExists) {
      await rm(mcpFile, { force: true });
      console.log(`${fmt.green("✓")} Deleted .mcp.json`);
    }
    const cleaned = await cleanOtelConfig(repoPath, false);
    if (cleaned) {
      console.log(`${fmt.green("✓")} Removed OTEL vars from .claude/settings.local.json`);
    }
  }

  console.log(`\n${fmt.bold(projectName)} has been completely removed from Konductor.\n`);
}
