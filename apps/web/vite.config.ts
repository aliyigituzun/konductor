import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFile, mkdir, readFile, readdir, writeFile, rm, appendFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  KonductorConfig,
  ProjectTokensFile,
  RunSummary,
  SkillProfile,
} from "@konductor/schema";

const execFileAsync = promisify(execFile);

/** Minimal local file API plugin — serves registry + status JSON for the dashboard */
function konductorLocalApiPlugin(): Plugin {
  return {
    name: "konductor-local-api",
    configureServer(server) {
      const registryPath =
        process.env["KONDUCTOR_REGISTRY"] ??
        join(process.env["HOME"] ?? "~", ".konductor", "registry.json");

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();

        res.setHeader("Content-Type", "application/json");

        try {
          if (req.url === "/api/registry") {
            if (!existsSync(registryPath)) {
              res.end(JSON.stringify({ schema_version: "0.2.0", projects: [] }));
              return;
            }
            const raw = await readFile(registryPath, "utf-8");
            const registry = JSON.parse(raw) as {
              schema_version?: string;
              projects?: Array<{ repo_path?: string }>;
            };
            // Annotate each project with whether its repo_path still exists.
            // A moved/removed directory leaves a stale registry entry.
            registry.projects = (registry.projects ?? []).map((project) => ({
              ...project,
              reachable: typeof project.repo_path === "string" && existsSync(project.repo_path),
            }));
            res.end(JSON.stringify(registry));
            return;
          }

          if (req.url === "/api/host/health") {
            res.end(JSON.stringify(await fetchHostHealthLocal()));
            return;
          }

          if (req.url?.match(/^\/api\/project\/[^/]+\/info$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/info")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            res.end(JSON.stringify(importantProjectPathsLocal(entry.repo_path)));
            return;
          }

          if (req.url?.match(/^\/api\/project\/[^/]+\/agents$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/agents")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const runs = await listProjectRunsLocal(entry.repo_path);
            res.end(
              JSON.stringify({
                config: await readConfigLocal(entry.repo_path),
                tokens: await readProjectTokensLocal(entry.repo_path),
                active_runs: runs.filter((run) => run.status === "running" || run.status === "queued"),
                past_runs: runs.filter((run) => run.status !== "running" && run.status !== "queued"),
              })
            );
            return;
          }

          if (req.method === "PUT" && req.url?.match(/^\/api\/project\/[^/]+\/agents\/workspace$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/agents/workspace")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const body = JSON.parse(await readRequestBody(req)) as {
              agents?: KonductorConfig["agents"];
              tokens?: ProjectTokensFile;
            };
            const currentConfig = await readConfigLocal(entry.repo_path);
            if (!currentConfig) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "Project config not found" }));
              return;
            }
            const nextConfig: KonductorConfig = {
              ...currentConfig,
              agents: normalizeAgentsWorkspace(body.agents ?? currentConfig.agents),
            };
            if ((nextConfig.agents?.profiles.length ?? 0) === 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "At least one agent profile is required." }));
              return;
            }
            if (!nextConfig.agents?.profiles.some((profile) => profile.id === nextConfig.agents?.default_profile)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Default profile must reference an existing agent profile." }));
              return;
            }

            const tokens = normalizeProjectTokensPayload(body.tokens);
            const bindingErrors = validateAgentTokenBindingsLocal(nextConfig, tokens);
            if (bindingErrors.length > 0) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: bindingErrors[0], details: bindingErrors }));
              return;
            }

            await writeConfigLocal(entry.repo_path, nextConfig);
            await writeProjectTokensLocal(entry.repo_path, tokens);
            await ensureProjectMcpConfigLocal(entry.repo_path);

            const runs = await listProjectRunsLocal(entry.repo_path);
            res.end(
              JSON.stringify({
                config: await readConfigLocal(entry.repo_path),
                tokens: await readProjectTokensLocal(entry.repo_path),
                active_runs: runs.filter((run) => run.status === "running" || run.status === "queued"),
                past_runs: runs.filter((run) => run.status !== "running" && run.status !== "queued"),
              })
            );
            return;
          }

          if (req.url?.match(/^\/api\/skills\/search\?/)) {
            const queryString = req.url.split("/api/skills/search?")[1] ?? "";
            const params = new URLSearchParams(queryString);
            const query = params.get("q")?.trim() ?? "";
            if (!query) {
              res.end(JSON.stringify({ objects: [] }));
              return;
            }
            const response = await fetch(
              `https://registry.npmjs.org/-/v1/search?size=8&text=${encodeURIComponent(query)}`,
            );
            const text = await response.text();
            res.statusCode = response.status;
            res.end(text);
            return;
          }

          if (req.method === "POST" && req.url?.match(/^\/api\/project\/[^/]+\/skills\/install$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/skills/install")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const body = JSON.parse(await readRequestBody(req)) as {
              package_name?: string;
              version?: string;
            };
            if (!body.package_name?.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing package name" }));
              return;
            }
            const pkgSpec = `${body.package_name.trim()}${body.version?.trim() ? `@${body.version.trim()}` : ""}`;
            try {
              const result = await execFileAsync("npm", ["install", pkgSpec], {
                cwd: entry.repo_path,
                maxBuffer: 1024 * 1024 * 8,
              });
              res.end(
                JSON.stringify({
                  ok: true,
                  command: `npm install ${pkgSpec}`,
                  stdout: result.stdout,
                  stderr: result.stderr,
                })
              );
            } catch (error) {
              const failure = error as {
                stdout?: string;
                stderr?: string;
                message?: string;
              };
              res.statusCode = 500;
              res.end(
                JSON.stringify({
                  error: failure.message ?? `Failed to install ${pkgSpec}`,
                  command: `npm install ${pkgSpec}`,
                  stdout: failure.stdout ?? "",
                  stderr: failure.stderr ?? "",
                })
              );
            }
            return;
          }

          if (req.method === "POST" && req.url?.match(/^\/api\/project\/[^/]+\/runs$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/runs")[0]!;
            const body = await readRequestBody(req);
            const response = await proxyHostRequest(`/projects/${projectId}/runs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            });
            res.statusCode = response.status;
            res.end(response.body);
            return;
          }

          if (req.method === "POST" && req.url?.match(/^\/api\/project\/[^/]+\/features$/)) {
            const projectId = req.url.split("/api/project/")[1]!.split("/features")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const body = JSON.parse(await readRequestBody(req)) as {
              title?: string;
              description?: string;
              category_id?: string;
              category_title?: string;
            };
            if (!body.title?.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing feature title" }));
              return;
            }
            const created = await createFeatureLocal(entry.repo_path, body);
            res.end(JSON.stringify(created));
            return;
          }

          if (req.url?.match(/^\/api\/run\/[^/]+$/)) {
            const runId = req.url.split("/api/run/")[1]!;
            try {
              const target = await hostTarget(`/runs/${runId}`);
              const response = await fetch(target);
              const text = await response.text();
              res.statusCode = response.status;
              res.end(text);
            } catch {
              const run = await readRunSummaryLocal(runId);
              if (!run) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: "Run not found" }));
                return;
              }
              res.end(JSON.stringify(run));
            }
            return;
          }

          if (req.url?.match(/^\/api\/run\/[^/]+\/terminal$/)) {
            const runId = req.url.split("/api/run/")[1]!.split("/terminal")[0]!;
            try {
              const target = await hostTarget(`/runs/${runId}/terminal`);
              const response = await fetch(target);
              const text = await response.text();
              res.statusCode = response.status;
              res.end(text);
            } catch {
              const run = await readRunSummaryLocal(runId);
              if (!run) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: "Run not found" }));
                return;
              }
              res.end(JSON.stringify({ run, log: await readRunLogLocal(runId) }));
            }
            return;
          }

          if (req.method === "POST" && req.url?.match(/^\/api\/run\/[^/]+\/stop$/)) {
            const runId = req.url.split("/api/run/")[1]!.split("/stop")[0]!;
            const response = await proxyHostRequest(`/runs/${runId}/stop`, { method: "POST" });
            res.statusCode = response.status;
            res.end(response.body);
            return;
          }

          if (req.url?.match(/^\/api\/project\/[^/]+\/docs$/)) {
            const url = req.url;
            const projectId = url.split("/api/project/")[1]!.split("/docs")[0]!;
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const mdFiles = await listMdFiles(entry.repo_path);
            res.end(JSON.stringify({ files: mdFiles }));
            return;
          }

          if (req.url?.match(/^\/api\/project\/[^/]+\/doc(\?|$)/)) {
            const url = req.url;
            const parts = url.split("/api/project/")[1]!.split("/doc");
            const projectId = parts[0]!;
            const qs = new URLSearchParams(parts[1]?.slice(1) ?? "");
            const filename = qs.get("file");
            if (!filename) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: "Missing file param" }));
              return;
            }
            const entry = await getProjectEntry(registryPath, projectId, res);
            if (!entry) return;
            const filePath = resolveRepoDoc(entry.repo_path, filename);
            if (!filePath || !existsSync(filePath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "File not found" }));
              return;
            }
            const content = await readFile(filePath, "utf-8");
            res.end(JSON.stringify({ content }));
            return;
          }

          if (req.method === "DELETE" && req.url?.match(/^\/api\/project\/[^/]+$/)) {
            const projectId = req.url.split("/api/project/")[1]!;
            if (!existsSync(registryPath)) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "No registry" }));
              return;
            }
            const regRaw = await readFile(registryPath, "utf-8");
            const registry = JSON.parse(regRaw) as {
              schema_version: string;
              projects: Array<{
                id: string;
                repo_path: string;
                status_path: string;
                history_dir: string;
              }>;
            };
            const entry = registry.projects.find((p) => p.id === projectId);
            if (!entry) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "Project not found" }));
              return;
            }
            // Remove from registry
            registry.projects = registry.projects.filter((p) => p.id !== projectId);
            await writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
            // Delete repo-local .konductor/ dir
            const konductorDir = join(dirname(dirname(entry.status_path)));
            if (existsSync(konductorDir)) {
              await rm(konductorDir, { recursive: true, force: true });
            }
            // Delete konductor.config.json
            const configFile = join(entry.repo_path, "konductor.config.json");
            if (existsSync(configFile)) {
              await rm(configFile, { force: true });
            }
            const mcpFile = join(entry.repo_path, ".mcp.json");
            if (existsSync(mcpFile)) {
              await rm(mcpFile, { force: true });
            }
            // Clean OTEL vars
            await cleanOtelConfigLocal(entry.repo_path);
            res.end(JSON.stringify({ ok: true }));
            return;
          }

          if (req.url?.match(/^\/api\/project\/[^/]+$/)) {
            const projectId = req.url.split("/api/project/")[1];
            const regRaw = await readFile(registryPath, "utf-8");
            const registry = JSON.parse(regRaw) as {
              projects: Array<{
                id: string;
                repo_path: string;
                status_path: string;
                telemetry_path: string;
                history_dir: string;
              }>;
            };
            const entry = registry.projects.find((p) => p.id === projectId);
            if (!entry) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "Project not found" }));
              return;
            }

            const status = existsSync(entry.status_path)
              ? JSON.parse(await readFile(entry.status_path, "utf-8"))
              : null;
            const telemetry = existsSync(entry.telemetry_path)
              ? JSON.parse(await readFile(entry.telemetry_path, "utf-8"))
              : null;
            const runs = await listProjectRunsLocal(entry.repo_path);
            const config = await readConfigLocal(entry.repo_path);

            let history: unknown[] = [];
            if (existsSync(entry.history_dir)) {
              const files = (await readdir(entry.history_dir))
                .filter((f) => f.endsWith(".json"))
                .sort()
                .slice(-30);
              history = await Promise.all(
                files.map(async (f) =>
                  JSON.parse(await readFile(join(entry.history_dir, f), "utf-8"))
                )
              );
            }

            // updates.jsonl lives at .konductor/updates.jsonl — derive from status_path
            const updatesFile = join(dirname(dirname(entry.status_path)), "updates.jsonl");
            let updates: unknown[] = [];
            if (existsSync(updatesFile)) {
              const raw = await readFile(updatesFile, "utf-8");
              updates = raw
                .split("\n")
                .filter(Boolean)
                .map((line) => JSON.parse(line));
            }

            res.end(
              JSON.stringify({
                entry,
                status,
                telemetry,
                history,
                updates,
                runs,
                config,
                important_paths: importantProjectPathsLocal(entry.repo_path),
              })
            );
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function normalizeAgentsWorkspace(
  agents: KonductorConfig["agents"] | null | undefined,
): NonNullable<KonductorConfig["agents"]> {
  const next = agents ?? {
    default_profile: "default-profile",
    profiles: [],
    prompt_packs: [],
    skill_profiles: [],
  };

  return {
    default_profile: next.default_profile,
    profiles: next.profiles ?? [],
    prompt_packs: next.prompt_packs ?? [],
    skill_profiles: next.skill_profiles ?? [],
    tasks: next.tasks,
  };
}

function normalizeProjectTokensPayload(tokens: ProjectTokensFile | null | undefined): ProjectTokensFile {
  return {
    schema_version: "0.2.0",
    tokens: tokens?.tokens ?? [],
  };
}

type HostHealthPayload = {
  ok: boolean;
  running: boolean;
  host_id: string | null;
  pid: number | null;
  port: number;
  running_runs: string[];
  state_path: string;
  log_path: string;
  stale_pid: boolean;
  error?: string;
  code?: string;
  hint?: string;
  details?: string[];
};

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPidAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readHostPidLocal(): Promise<number | null> {
  const pidFile = join(homedir(), ".konductor", "host", "host.pid");
  if (!existsSync(pidFile)) return null;
  try {
    const raw = await readFile(pidFile, "utf-8");
    const pid = parseInt(raw.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

async function readHostStateLocal(): Promise<{ host_id?: string; port?: number; pid?: number } | null> {
  const statePath = join(homedir(), ".konductor", "host", "state.json");
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(await readFile(statePath, "utf-8")) as { host_id?: string; port?: number; pid?: number };
  } catch {
    return null;
  }
}

async function fetchHostHealthLocal(): Promise<HostHealthPayload> {
  const statePath = join(homedir(), ".konductor", "host", "state.json");
  const logPath = join(homedir(), ".konductor", "host", "host.log");
  const state = await readHostStateLocal();
  const pid = (await readHostPidLocal()) ?? state?.pid ?? null;
  const port = state?.port ?? 4096;
  const stalePid = pid !== null && !isPidAlive(pid);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const text = await response.text();
    const payload = safeJsonParse(text) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      throw new Error(`Health check returned HTTP ${response.status}`);
    }
    return {
      ok: true,
      running: true,
      host_id: String(payload["host_id"] ?? state?.host_id ?? "local-host"),
      pid: (() => {
        const value = Number(payload["pid"] ?? pid ?? 0);
        if (value) return value;
        if (pid !== null) return pid;
        return null;
      })(),
      port: Number(payload["port"] ?? port),
      running_runs: Array.isArray(payload["running_runs"])
        ? (payload["running_runs"] as string[])
        : [],
      state_path: statePath,
      log_path: logPath,
      stale_pid: false,
    };
  } catch {
    return {
      ok: false,
      running: false,
      host_id: state?.host_id ?? null,
      pid,
      port,
      running_runs: [],
      state_path: statePath,
      log_path: logPath,
      stale_pid: stalePid,
      error: stalePid
        ? "Konductor host is not running and the pid file is stale."
        : "Konductor host is not running.",
      code: "HOST_UNREACHABLE",
      hint: stalePid
        ? "Run `konductor host start` to replace the stale host process state."
        : "Run `konductor host start` in a terminal before sending work to Claude.",
      details: [
        `Host URL: http://127.0.0.1:${port}`,
        `Host state: ${statePath}`,
        `Host log: ${logPath}`,
      ],
    };
  }
}

async function proxyHostRequest(
  pathname: string,
  init?: RequestInit,
): Promise<{ status: number; body: string }> {
  try {
    const target = await hostTarget(pathname);
    const response = await fetch(target, init);
    return {
      status: response.status,
      body: await response.text(),
    };
  } catch {
    const health = await fetchHostHealthLocal();
    return {
      status: 503,
      body: JSON.stringify({
        error: health.error ?? "Konductor host is not running.",
        code: health.code ?? "HOST_UNREACHABLE",
        hint: health.hint ?? "Run `konductor host start` and try again.",
        details: health.details ?? [],
      }),
    };
  }
}

async function hostTarget(pathname: string): Promise<string> {
  const statePath = join(homedir(), ".konductor", "host", "state.json");
  if (!existsSync(statePath)) {
    return `http://127.0.0.1:4096${pathname}`;
  }
  try {
    const raw = JSON.parse(await readFile(statePath, "utf-8")) as { port?: number };
    const port = raw.port ?? 4096;
    return `http://127.0.0.1:${port}${pathname}`;
  } catch {
    return `http://127.0.0.1:4096${pathname}`;
  }
}

const OTEL_KEYS = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_PROTOCOL",
  "CLAUDE_CODE_ENABLE_TELEMETRY",
  "OTEL_METRICS_EXPORTER",
  "OTEL_LOGS_EXPORTER",
  "OTEL_METRIC_EXPORT_INTERVAL",
  "OTEL_LOGS_EXPORT_INTERVAL",
];

async function cleanOtelConfigLocal(repoPath: string): Promise<void> {
  const settingsPath = join(repoPath, ".claude", "settings.local.json");
  if (!existsSync(settingsPath)) return;
  try {
    const raw = await readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const env = settings["env"] as Record<string, string> | undefined;
    if (!env) return;
    for (const k of OTEL_KEYS) delete env[k];
    if (Object.keys(env).length === 0) delete settings["env"];
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // best-effort
  }
}

async function getProjectEntry(
  registryPath: string,
  projectId: string,
  res: ServerResponse<IncomingMessage>,
): Promise<{ repo_path: string; status_path: string; telemetry_path: string; history_dir: string } | null> {
  if (!existsSync(registryPath)) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "No registry" }));
    return null;
  }
  const reg = JSON.parse(await readFile(registryPath, "utf-8")) as {
    projects: Array<{ id: string; repo_path: string; status_path: string; telemetry_path: string; history_dir: string }>;
  };
  const entry = reg.projects.find((p) => p.id === projectId) ?? null;
  if (!entry) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Project not found" }));
    return null;
  }
  return entry;
}

async function readConfigLocal(repoPath: string): Promise<KonductorConfig | null> {
  const file = join(repoPath, "konductor.config.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf-8")) as KonductorConfig;
}

async function writeConfigLocal(repoPath: string, config: KonductorConfig): Promise<void> {
  await writeFile(join(repoPath, "konductor.config.json"), JSON.stringify(config, null, 2), "utf-8");
}

async function ensureProjectMcpConfigLocal(repoPath: string): Promise<void> {
  const mcpPath = join(repoPath, ".mcp.json");
  let existing: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try {
      existing = JSON.parse(await readFile(mcpPath, "utf-8")) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const mcpServers = ((existing["mcpServers"] ?? {}) as Record<string, unknown>) ?? {};
  const next = {
    ...existing,
    mcpServers: {
      ...mcpServers,
      konductor: {
        type: "stdio",
        command: "konductor",
        args: ["mcp", "serve"],
        env: {
          KONDUCTOR_RUN_ID: "${KONDUCTOR_RUN_ID:-}",
          KONDUCTOR_PROFILE_ID: "${KONDUCTOR_PROFILE_ID:-}",
          KONDUCTOR_FEATURE_ITEM_ID: "${KONDUCTOR_FEATURE_ITEM_ID:-}",
          KONDUCTOR_RUN_SOURCE: "${KONDUCTOR_RUN_SOURCE:-cli}",
        },
      },
    },
  };

  const existingJson = JSON.stringify(existing);
  const nextJson = JSON.stringify(next);
  if (existingJson === nextJson) return;
  await writeFile(mcpPath, JSON.stringify(next, null, 2), "utf-8");
}

async function readProjectTokensLocal(repoPath: string): Promise<ProjectTokensFile> {
  const file = join(repoPath, ".konductor", "tokens.json");
  if (!existsSync(file)) {
    return { schema_version: "0.2.0", tokens: [] };
  }
  return JSON.parse(await readFile(file, "utf-8")) as ProjectTokensFile;
}

async function writeProjectTokensLocal(repoPath: string, tokens: ProjectTokensFile): Promise<void> {
  const file = join(repoPath, ".konductor", "tokens.json");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(tokens, null, 2), "utf-8");
}

function validateAgentTokenBindingsLocal(
  config: KonductorConfig,
  tokensFile: ProjectTokensFile,
): string[] {
  const errors: string[] = [];
  for (const profile of config.agents?.profiles ?? []) {
    if (profile.runner === "claude_code") continue;
    if (!profile.token_id) {
      errors.push(`Profile "${profile.title}" is missing a project token selection.`);
      continue;
    }
    const token = tokensFile.tokens.find((entry) => entry.id === profile.token_id) ?? null;
    if (!token) {
      errors.push(`Profile "${profile.title}" references a missing project token.`);
      continue;
    }
    if (token.provider !== profile.runner) {
      errors.push(
        `Profile "${profile.title}" uses a ${token.provider} token but is configured for ${profile.runner}.`,
      );
    }
  }
  return errors;
}

/**
 * Resolve a caller-supplied doc filename against a repo root, refusing anything that
 * escapes it. Returns null when the request is not a markdown file inside the repo.
 */
function resolveRepoDoc(repoPath: string, filename: string): string | null {
  if (!filename.endsWith(".md")) return null;
  const root = resolve(repoPath);
  const target = resolve(root, filename);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function listMdFiles(repoPath: string): Promise<string[]> {
  if (!existsSync(repoPath)) return [];
  const files = await readdir(repoPath);
  return files.filter((f) => f.endsWith(".md")).sort();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(existing: Set<string>, base: string): string {
  const root = slugify(base) || "feature";
  let candidate = root;
  let index = 2;
  while (existing.has(candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }
  return candidate;
}

async function readRunSummaryLocal(runId: string): Promise<unknown | null> {
  const file = join(homedir(), ".konductor", "host", "runs", `${runId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf-8"));
}

async function readRunLogLocal(runId: string): Promise<string> {
  const file = join(homedir(), ".konductor", "host", "logs", `${runId}.log`);
  if (!existsSync(file)) return "";
  return readFile(file, "utf-8");
}

async function listProjectRunsLocal(repoPath: string): Promise<RunSummary[]> {
  const dir = join(repoPath, ".konductor", "runs");
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json")).sort();
  const runs: RunSummary[] = [];
  for (const file of files) {
    try {
      runs.push(JSON.parse(await readFile(join(dir, file), "utf-8")) as RunSummary);
    } catch {
      // Skip corrupted entries.
    }
  }
  return runs.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
  );
}

function importantProjectPathsLocal(repoPath: string) {
  const konductorDir = join(repoPath, ".konductor");
  return {
    repo_root: repoPath,
    config_path: join(repoPath, "konductor.config.json"),
    konductor_dir: konductorDir,
    tokens_path: join(konductorDir, "tokens.json"),
    status_path: join(konductorDir, "status", "current.json"),
    updates_path: join(konductorDir, "updates.jsonl"),
    telemetry_path: join(konductorDir, "telemetry", "latest.json"),
    history_dir: join(konductorDir, "history"),
    runs_dir: join(konductorDir, "runs"),
    registry_path: join(homedir(), ".konductor", "registry.json"),
    host_dir: join(homedir(), ".konductor", "host"),
  };
}

async function readStatusLocal(repoPath: string): Promise<Record<string, unknown>> {
  const statusPath = join(repoPath, ".konductor", "status", "current.json");
  return JSON.parse(await readFile(statusPath, "utf-8")) as Record<string, unknown>;
}

async function writeStatusLocal(repoPath: string, snapshot: Record<string, unknown>): Promise<void> {
  const statusDir = join(repoPath, ".konductor", "status");
  const statusPath = join(statusDir, "current.json");
  const backupsDir = join(repoPath, ".konductor", "backups");
  await mkdir(statusDir, { recursive: true });
  await mkdir(backupsDir, { recursive: true });
  if (existsSync(statusPath)) {
    const ts = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
    await copyFile(statusPath, join(backupsDir, `current-${ts}.json`));
  }
  await writeFile(statusPath, JSON.stringify(snapshot, null, 2), "utf-8");
}

async function appendUpdateLocal(repoPath: string, entry: Record<string, unknown>): Promise<void> {
  const updatesPath = join(repoPath, ".konductor", "updates.jsonl");
  await appendFile(updatesPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

async function createFeatureLocal(
  repoPath: string,
  body: {
    title?: string;
    description?: string;
    category_id?: string;
    category_title?: string;
  },
): Promise<{ category_id: string; feature_item_id: string }> {
  const status = await readStatusLocal(repoPath);
  const features = Array.isArray(status["features"]) ? [...(status["features"] as Array<Record<string, unknown>>)] : [];
  const categoryIds = new Set(
    features
      .map((category) => String(category["id"] ?? ""))
      .filter(Boolean),
  );
  const itemIds = new Set(
    features.flatMap((category) =>
      Array.isArray(category["items"])
        ? (category["items"] as Array<Record<string, unknown>>)
            .map((item) => String(item["id"] ?? ""))
            .filter(Boolean)
        : [],
    ),
  );

  let categoryId = body.category_id?.trim() ?? "";
  let category = features.find((entry) => String(entry["id"] ?? "") === categoryId) ?? null;
  if (!category) {
    const categoryTitle = body.category_title?.trim();
    if (!categoryTitle) {
      throw new Error("Missing feature category");
    }
    categoryId = uniqueId(categoryIds, categoryTitle);
    category = {
      id: categoryId,
      title: categoryTitle,
      items: [],
    };
    features.push(category);
  }

  const featureId = uniqueId(itemIds, body.title ?? "feature");
  const nextItem = {
    id: featureId,
    title: body.title?.trim(),
    status: "todo",
    description: body.description?.trim() || undefined,
  };

  const categoryItems = Array.isArray(category["items"]) ? [...(category["items"] as Array<Record<string, unknown>>)] : [];
  categoryItems.push(nextItem);
  category["items"] = categoryItems;

  status["schema_version"] = "0.2.0";
  status["features"] = features;
  await writeStatusLocal(repoPath, status);
  await appendUpdateLocal(repoPath, {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind: "milestone",
    message: `Added feature "${body.title?.trim()}" to ${String(category["title"] ?? categoryId)}.`,
    agent: "dashboard",
    feature_item_id: featureId,
    source: "dashboard",
  });
  return {
    category_id: categoryId,
    feature_item_id: featureId,
  };
}

export default defineConfig({
  plugins: [react(), konductorLocalApiPlugin()],
  server: {
    port: 5173,
  },
});
