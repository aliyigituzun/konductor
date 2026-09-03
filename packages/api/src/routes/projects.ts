import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  DEFAULT_OTEL_ENV,
  configPath,
  ensureProjectMcpConfig,
  getProject,
  importantProjectPaths,
  listProjectRuns,
  readConfig,
  readHistory,
  readRegistryWithReachability,
  readStatus,
  readTelemetry,
  readUpdates,
  removeProject,
  repoLocal,
  writeConfig,
} from "@konductor/store";
import type { KonductorConfig, RegistryEntry, StatusSnapshot } from "@konductor/schema";
import { KonductorConfigSchema } from "@konductor/schema";
import { ApiError, json, readJsonBody, type Router } from "../router.js";

async function requireProject(id: string): Promise<RegistryEntry> {
  const entry = await getProject(id);
  if (!entry) {
    throw new ApiError(`Project ${id} not found.`, {
      status: 404,
      code: "PROJECT_NOT_FOUND",
      hint: "Run `konductor init` in the repo, or refresh the dashboard registry.",
    });
  }
  if (!existsSync(entry.repo_path)) {
    throw new ApiError(`Project ${id} is registered at a path that no longer exists.`, {
      status: 410,
      code: "PROJECT_UNREACHABLE",
      hint: `Expected it at ${entry.repo_path}. Re-run \`konductor init\` from its new location.`,
    });
  }
  return entry;
}

/**
 * Resolve a caller-supplied doc filename against a repo root.
 *
 * Checking only for an `.md` suffix let `../../../etc/passwd.md` out of the repo.
 */
function resolveRepoDoc(repoPath: string, filename: string): string | null {
  if (!filename.endsWith(".md")) return null;
  const root = resolve(repoPath);
  const target = resolve(root, filename);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

/** Strip the OTEL variables Konductor added, leaving anything the user set. */
async function cleanOtelConfig(repoPath: string): Promise<void> {
  const settingsPath = join(repoPath, ".claude", "settings.local.json");
  if (!existsSync(settingsPath)) return;
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf-8")) as Record<string, unknown>;
    const env = settings["env"] as Record<string, string> | undefined;
    if (!env) return;
    for (const key of Object.keys(DEFAULT_OTEL_ENV)) delete env[key];
    if (Object.keys(env).length === 0) delete settings["env"];
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // A malformed settings file is the user's to fix; deletion should not fail on it.
  }
}

export function registerProjectRoutes(router: Router): void {
  router.get("/api/registry", async () => json(await readRegistryWithReachability()));

  router.get("/api/project/:id/info", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    return json(importantProjectPaths(entry.repo_path));
  });

  router.get("/api/project/:id/docs", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const files = (await readdir(entry.repo_path))
      .filter((file) => file.endsWith(".md"))
      .sort();
    return json({ files });
  });

  router.get("/api/project/:id/doc", async ({ params, url }) => {
    const entry = await requireProject(params["id"]!);
    const filename = url.searchParams.get("file");
    if (!filename) {
      throw new ApiError("Missing `file` query parameter.", {
        status: 400,
        code: "MISSING_FILE",
      });
    }
    const filePath = resolveRepoDoc(entry.repo_path, filename);
    if (!filePath || !existsSync(filePath)) {
      throw new ApiError("File not found.", { status: 404, code: "DOC_NOT_FOUND" });
    }
    return json({ content: await readFile(filePath, "utf-8") });
  });

  router.get("/api/project/:id/agents", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const [config, runs] = await Promise.all([
      readConfig(entry.repo_path),
      listProjectRuns(entry.repo_path),
    ]);
    const isActive = (status: string) => status === "running" || status === "queued";
    return json({
      config,
      active_runs: runs.filter((run) => isActive(run.status)),
      past_runs: runs.filter((run) => !isActive(run.status)),
    });
  });

  router.put("/api/project/:id/agents/workspace", async ({ params, request }) => {
    const entry = await requireProject(params["id"]!);
    const body = await readJsonBody<{ agents?: NonNullable<KonductorConfig["agents"]> }>(request);
    const current = await readConfig(entry.repo_path);
    if (!current) {
      throw new ApiError("Project has no konductor.config.json.", {
        status: 400,
        code: "CONFIG_MISSING",
      });
    }
    const agents = body.agents;
    if (!agents || agents.profiles.length === 0) {
      throw new ApiError("A project needs at least one agent profile.", {
        status: 400,
        code: "PROFILES_REQUIRED",
      });
    }
    if (!agents.profiles.some((profile) => profile.id === agents.default_profile)) {
      throw new ApiError("The default profile is not one of the configured profiles.", {
        status: 400,
        code: "DEFAULT_PROFILE_INVALID",
      });
    }

    const next = KonductorConfigSchema.parse({ ...current, agents });
    await writeConfig(entry.repo_path, next);
    if (agents.profiles.some((profile) => profile.default_mcp !== false)) {
      await ensureProjectMcpConfig(entry.repo_path);
    }

    const runs = await listProjectRuns(entry.repo_path);
    const isActive = (status: string) => status === "running" || status === "queued";
    return json({
      config: next,
      active_runs: runs.filter((run) => isActive(run.status)),
      past_runs: runs.filter((run) => !isActive(run.status)),
    });
  });

  router.delete("/api/project/:id", async ({ params }) => {
    const id = params["id"]!;
    const entry = await getProject(id);
    await removeProject(id);

    const removed: string[] = [];
    if (entry && existsSync(entry.repo_path)) {
      const paths = repoLocal(entry.repo_path);
      for (const target of [paths.dir, configPath(entry.repo_path), join(entry.repo_path, ".mcp.json")]) {
        if (existsSync(target)) {
          await rm(target, { recursive: true, force: true });
          removed.push(target);
        }
      }
      await cleanOtelConfig(entry.repo_path);
    }
    return json({ deleted: id, removed });
  });

  // Declared last: it would otherwise shadow the more specific /project/:id/* routes.
  router.get("/api/project/:id", async ({ params }) => {
    const entry = await requireProject(params["id"]!);
    const repo = entry.repo_path;
    const [status, telemetry, history, updates, runs, config] = await Promise.all([
      readStatus(repo),
      readTelemetry(repo),
      readHistory(repoLocal(repo).historyDir),
      readUpdates(repo),
      listProjectRuns(repo),
      readConfig(repo),
    ]);
    return json({
      entry,
      status,
      telemetry,
      history,
      updates,
      runs,
      config,
      important_paths: importantProjectPaths(repo),
    });
  });
}

export { requireProject, resolveRepoDoc };
export type { StatusSnapshot };
