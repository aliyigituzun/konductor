import type {
  AgentProfile,
  KonductorConfig,
  ProjectToken,
  ProjectTokensFile,
  ProjectImportantPaths,
  PromptPack,
  Registry,
  RunSummary,
  SkillProfile,
  StatusSnapshot,
  TelemetrySnapshot,
  UpdateEntry,
} from "./types.js";

export interface ApiErrorPayload {
  error?: string;
  code?: string;
  hint?: string;
  details?: string[];
  run_id?: string;
}

export interface HostHealth {
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
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  hint: string | null;
  details: string[];
  runId: string | null;

  constructor(message: string, options: {
    status: number;
    code?: string | null;
    hint?: string | null;
    details?: string[];
    runId?: string | null;
  }) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.hint = options.hint ?? null;
    this.details = options.details ?? [];
    this.runId = options.runId ?? null;
  }
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function requestJson<T>(input: RequestInfo | URL, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await fetch(input, init);
  const text = await res.text();
  const parsed = text ? safeJsonParse(text) : null;
  if (!res.ok) {
    const payload = (parsed ?? {}) as ApiErrorPayload;
    throw new ApiError(payload.error ?? fallback, {
      status: res.status,
      code: payload.code ?? null,
      hint: payload.hint ?? null,
      details: Array.isArray(payload.details) ? payload.details.map(String) : [],
      runId: payload.run_id ?? null,
    });
  }
  if (parsed !== null) return parsed as T;
  throw new ApiError(fallback, { status: res.status });
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    return [
      error.message,
      error.hint ? `Hint: ${error.hint}` : null,
      error.code ? `Code: ${error.code}` : null,
      error.runId ? `Run ID: ${error.runId}` : null,
      ...error.details,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function fetchRegistry(): Promise<Registry> {
  return requestJson<Registry>("/api/registry", undefined, "Failed to fetch registry");
}

export interface ProjectData {
  entry: Registry["projects"][number];
  status: StatusSnapshot | null;
  telemetry: TelemetrySnapshot | null;
  history: unknown[];
  updates: UpdateEntry[];
  runs: RunSummary[];
  config: KonductorConfig | null;
  important_paths: ProjectImportantPaths;
}

export async function fetchProject(id: string): Promise<ProjectData> {
  return requestJson<ProjectData>(`/api/project/${id}`, undefined, `Failed to fetch project ${id}`);
}

export async function deleteProject(id: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/project/${id}`, { method: "DELETE" }, `Failed to delete project ${id}`);
}

export interface AgentData {
  config: KonductorConfig | null;
  tokens: ProjectTokensFile;
  active_runs: RunSummary[];
  past_runs: RunSummary[];
}

export interface AgentWorkspaceConfig {
  default_profile: string;
  profiles: AgentProfile[];
  prompt_packs: PromptPack[];
  skill_profiles: SkillProfile[];
  tasks?: NonNullable<KonductorConfig["agents"]>["tasks"];
}

export interface AgentWorkspacePayload {
  agents: AgentWorkspaceConfig;
  tokens: ProjectTokensFile;
}

export interface StartRunPayload {
  profile_id?: string;
  prompt: string;
  prompt_packs?: string[];
  feature_item_id?: string | null;
  source?: "dashboard" | "cli";
}

export interface CreateFeaturePayload {
  title: string;
  description?: string;
  category_id?: string;
  category_title?: string;
}

export async function fetchProjectAgents(id: string): Promise<AgentData> {
  return requestJson<AgentData>(
    `/api/project/${id}/agents`,
    undefined,
    `Failed to fetch project agents for ${id}`,
  );
}

export async function saveProjectAgentsWorkspace(
  id: string,
  payload: AgentWorkspacePayload,
): Promise<AgentData> {
  return requestJson<AgentData>(
    `/api/project/${id}/agents/workspace`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to save agent workspace for ${id}`,
  );
}

export async function startProjectRun(id: string, payload: StartRunPayload): Promise<RunSummary> {
  return requestJson<RunSummary>(
    `/api/project/${id}/runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to start run for ${id}`,
  );
}

export async function fetchRun(runId: string): Promise<RunSummary> {
  return requestJson<RunSummary>(`/api/run/${runId}`, undefined, `Failed to fetch run ${runId}`);
}

export async function fetchRunTerminal(runId: string): Promise<{ run: RunSummary; log: string }> {
  return requestJson<{ run: RunSummary; log: string }>(
    `/api/run/${runId}/terminal`,
    undefined,
    `Failed to fetch terminal for ${runId}`,
  );
}

export async function stopProjectRun(runId: string): Promise<RunSummary> {
  return requestJson<RunSummary>(
    `/api/run/${runId}/stop`,
    { method: "POST" },
    `Failed to stop run ${runId}`,
  );
}

export async function createProjectFeature(
  id: string,
  payload: CreateFeaturePayload,
): Promise<{ category_id: string; feature_item_id: string }> {
  return requestJson<{ category_id: string; feature_item_id: string }>(
    `/api/project/${id}/features`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to create feature for ${id}`,
  );
}

export async function fetchHostHealth(): Promise<HostHealth> {
  return requestJson<HostHealth>("/api/host/health", undefined, "Failed to fetch host health");
}

export interface NpmSkillSearchResult {
  package: {
    name: string;
    version: string;
    description?: string;
    keywords?: string[];
    links?: Record<string, string>;
  };
}

export interface NpmSkillSearchResponse {
  objects: NpmSkillSearchResult[];
}

export async function searchSkillRegistry(query: string): Promise<NpmSkillSearchResponse> {
  return requestJson<NpmSkillSearchResponse>(
    `/api/skills/search?q=${encodeURIComponent(query)}`,
    undefined,
    "Failed to search npm registry",
  );
}

export interface SkillInstallResult {
  ok?: boolean;
  command: string;
  stdout: string;
  stderr: string;
  error?: string;
}

export async function installSkillPackage(
  id: string,
  payload: { package_name: string; version?: string },
): Promise<SkillInstallResult> {
  return requestJson<SkillInstallResult>(
    `/api/project/${id}/skills/install`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to install skill package for ${id}`,
  );
}
