import type {
  AgentProfile,
  AssetLibrary,
  AssetBucket,
  AssetManagerConfig,
  AssetMetadata,
  AssetVariation,
  Decision,
  DecisionFeatureDraft,
  DecisionImpact,
  DecisionKind,
  ManagedAsset,
  KonductorConfig,
  ProjectImportantPaths,
  PromptPack,
  Registry,
  RunSummary,
  SkillProfile,
  ProviderConnection,
  StatusSnapshot,
  TelemetrySnapshot,
  UpdateEntry,
  AccessTokenSummary,
  AuthStatus,
  AuthUser,
  ConfigurationScopeType,
  ConfigurationState,
  FeatureFlags,
  UserPermissionSet,
  RemoteAccessSettings,
  ThemePreference,
  TokenPermission,
  TokenRole,
  ChangeRequest,
  ChangeRequestStatus,
  ChangeRequestSubmit,
  GitBranch,
  PortSettings,
  PreviewInstance,
  PreviewStatus,
  ReviewSession,
  ReviewSessionCreate,
  ProjectSpaceSummary,
  RootStatus,
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
    // The session ended under us: let the shell drop to the sign-in screen.
    if (res.status === 401 && payload.code === "SESSION_REQUIRED") {
      window.dispatchEvent(new Event(SESSION_REQUIRED_EVENT));
    }
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

export const SESSION_REQUIRED_EVENT = "konductor:session-required";

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return requestJson<AuthStatus>("/api/auth/session", undefined, "Failed to check the session");
}

export async function login(email: string, password: string): Promise<AuthStatus> {
  return requestJson<AuthStatus>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }, "Sign-in failed");
}

export async function saveMyTodoPins(pinnedPhaseIds: string[]): Promise<{ user: AuthUser }> {
  return requestJson("/api/auth/me/todo-pins", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned_todo_phase_ids: pinnedPhaseIds }),
  }, "Failed to save pinned phases");
}

export async function logout(): Promise<AuthStatus> {
  return requestJson<AuthStatus>("/api/auth/logout", { method: "POST" }, "Sign-out failed");
}

export async function fetchRootStatus(): Promise<RootStatus> {
  return requestJson<RootStatus>("/api/root/session", undefined, "Failed to check the root session");
}

export async function rootLogin(key: string): Promise<RootStatus> {
  return requestJson<RootStatus>("/api/root/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  }, "Root sign-in failed");
}

export async function rootLogout(): Promise<RootStatus> {
  return requestJson<RootStatus>("/api/root/logout", { method: "POST" }, "Root sign-out failed");
}

export async function fetchProjectSpaces(): Promise<{ spaces: ProjectSpaceSummary[] }> {
  return requestJson("/api/root/spaces", undefined, "Failed to load project spaces");
}

export async function createProjectSpace(input: {
  name: string;
  admin: { display_name: string; email: string; password: string };
}): Promise<{ space: ProjectSpaceSummary }> {
  return requestJson("/api/root/spaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Failed to create the project space");
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

export interface ConfigurationScope {
  type: ConfigurationScopeType;
  id: string;
  label: string;
  projectIds: string[];
}

function configurationBase(scope: Pick<ConfigurationScope, "type" | "id">): string {
  return `/api/config/${scope.type}/${encodeURIComponent(scope.id)}`;
}

export async function fetchConfiguration(scope: ConfigurationScope): Promise<ConfigurationState> {
  return requestJson(configurationBase(scope), undefined, `Failed to load ${scope.label} configuration`);
}

export async function saveGeneralConfiguration(
  scope: ConfigurationScope,
  theme: ThemePreference,
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/general`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }, "Failed to save appearance settings");
}

export async function saveRemoteConfiguration(
  scope: ConfigurationScope,
  remote: RemoteAccessSettings,
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/remote`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(remote),
  }, "Failed to save remote settings");
}

export async function saveAuthenticationEnabled(
  scope: ConfigurationScope,
  enabled: boolean,
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/auth`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  }, "Failed to save authentication settings");
}

export async function connectGitHub(
  scope: ConfigurationScope,
  token: string,
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/integrations/github`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }, "Failed to connect GitHub");
}

export async function disconnectGitHub(scope: ConfigurationScope): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/integrations/github`, {
    method: "DELETE",
  }, "Failed to disconnect GitHub");
}

export async function createConfigurationUser(
  scope: ConfigurationScope,
  input: { display_name: string; email: string; password: string; role: "admin" | "member"; permission_sets?: UserPermissionSet[] },
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/auth/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Failed to create user");
}

export async function saveConfigurationUserPermissionSets(
  scope: ConfigurationScope,
  userId: string,
  permissionSets: UserPermissionSet[],
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/auth/users/${encodeURIComponent(userId)}/permission-sets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission_sets: permissionSets }),
  }, "Failed to save permission sets");
}

export async function saveConfigurationUserTodoPins(
  scope: ConfigurationScope,
  userId: string,
  pinnedTodoPhaseIds: string[],
): Promise<ConfigurationState> {
  return requestJson(`${configurationBase(scope)}/auth/users/${encodeURIComponent(userId)}/todo-pins`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned_todo_phase_ids: pinnedTodoPhaseIds }),
  }, "Failed to save pinned to-do phases");
}

export async function fetchConfigurationTokens(
  scope: ConfigurationScope,
): Promise<AccessTokenSummary[]> {
  const projects = encodeURIComponent(scope.projectIds.join(","));
  const result = await requestJson<{ tokens: AccessTokenSummary[] }>(
    `${configurationBase(scope)}/tokens?projects=${projects}`,
    undefined,
    "Failed to load access tokens",
  );
  return result.tokens;
}

export async function createConfigurationToken(
  scope: ConfigurationScope,
  input: {
    name: string;
    project_ids: string[];
    role: TokenRole;
    permissions?: TokenPermission[];
    expires_at?: string | null;
  },
): Promise<{ token: string; record: AccessTokenSummary }> {
  return requestJson(`${configurationBase(scope)}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Failed to create access token");
}

export async function revokeConfigurationToken(tokenId: string): Promise<AccessTokenSummary> {
  const result = await requestJson<{ token: AccessTokenSummary }>(
    `/api/access-tokens/${encodeURIComponent(tokenId)}`,
    { method: "DELETE" },
    "Failed to revoke access token",
  );
  return result.token;
}

export interface ProjectData {
  entry: Registry["projects"][number];
  status: StatusSnapshot | null;
  telemetry: TelemetrySnapshot | null;
  history: unknown[];
  updates: UpdateEntry[];
  runs: RunSummary[];
  config: KonductorConfig | null;
  decisions: Decision[];
  important_paths: ProjectImportantPaths;
}

export async function fetchProject(id: string): Promise<ProjectData> {
  return requestJson<ProjectData>(`/api/project/${id}`, undefined, `Failed to fetch project ${id}`);
}

export async function resetProjectTelemetry(id: string): Promise<TelemetrySnapshot | null> {
  const result = await requestJson<{ telemetry: TelemetrySnapshot | null }>(
    `/api/project/${id}/telemetry/reset`,
    { method: "POST" },
    `Failed to reset telemetry for ${id}`,
  );
  return result.telemetry;
}

export async function deleteProject(id: string): Promise<void> {
  await requestJson<{ ok: true }>(`/api/project/${id}`, { method: "DELETE" }, `Failed to delete project ${id}`);
}

export interface AgentData {
  config: KonductorConfig | null;
  active_runs: RunSummary[];
  past_runs: RunSummary[];
}

export interface AgentWorkspaceConfig {
  default_profile: string;
  profiles: AgentProfile[];
  prompt_packs: PromptPack[];
  skill_profiles: SkillProfile[];
  provider_connections: ProviderConnection[];
  tasks?: NonNullable<KonductorConfig["agents"]>["tasks"];
}

export interface AgentWorkspacePayload {
  agents: AgentWorkspaceConfig;
  /** Pasted keys travel once to host-only secret storage and are never returned. */
  provider_keys?: Record<string, string>;
}

export interface StartRunPayload {
  profile_id?: string;
  prompt: string;
  prompt_packs?: string[];
  feature_item_id?: string | null;
  /** Multiple features selected together in the Features workspace. */
  feature_item_ids?: string[];
  todo_id?: string | null;
  /** Resolved decision the run carries out; the host adds its outcome to the brief. */
  decision_id?: string | null;
  source?: "dashboard" | "cli";
  slug?: string;
  /** Override the profile's provider/model for this launch. */
  provider?: string;
  model?: string;
  worktree?: boolean;
}

/** One live agent, as reported by the host's fleet endpoint. */
export interface FleetAgent {
  slug: string;
  run_id: string;
  project_id: string;
  profile_id: string | null;
  profile_title: string | null;
  adapter_id: string;
  adapter_title: string;
  provider: string | null;
  model: string | null;
  transport: "tmux";
  session_name: string;
  window_id: string;
  pane_id: string;
  /** Paste-ready shell command that attaches a terminal to this agent's window. */
  attach_command: string;
  agent_status: "starting" | "working" | "idle" | "blocked" | "done" | "dead";
  reason: string;
  cwd: string | null;
  worktree_path: string | null;
  branch: string | null;
  feature_item_title: string | null;
  started_at: string | null;
}

export interface AdapterModel {
  id: string;
  title?: string;
}

/** A provider a harness can drive, with the models its manifest lists for the picker. */
export interface AdapterProvider {
  id: string;
  title: string;
  models: AdapterModel[];
}

export interface AdapterProvider {
  id: string;
  title: string;
  models: Array<{ id: string; title?: string }>;
}

/** One agent Konductor knows how to drive, and whether it is installed here. */
export interface AdapterInfo {
  id: string;
  title: string;
  binary: string;
  homepage: string | null;
  verified: boolean;
  source: "builtin" | "user" | "project";
  manifest_path: string | null;
  /** The launch command line, with placeholders, for display. */
  launch: string;
  /** One entry means the harness is bound to that provider. */
  providers: AdapterProvider[];
  model_format: "id" | "provider/id";
  mcp: string;
  telemetry: string;
  setup: AdapterSetupStatus;
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface AdapterSetupStatus {
  supported: boolean;
  configured: boolean;
  directory: string | null;
  runtime_package: string | null;
  mcp_package: string | null;
  note: string | null;
}

export async function setupHarness(
  projectId: string,
  adapterId: string,
  installMissingBinary = false,
): Promise<AdapterSetupStatus & { changed: boolean }> {
  return requestJson(
    `/api/project/${projectId}/adapters/${encodeURIComponent(adapterId)}/setup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install_missing_binary: installMissingBinary }),
    },
    `Failed to set up ${adapterId}`,
  );
}

export async function fetchFleet(): Promise<{ agents: FleetAgent[] }> {
  return requestJson<{ agents: FleetAgent[] }>("/api/agents", undefined, "Failed to fetch fleet");
}

export async function fetchAdapters(projectId: string): Promise<{
  adapters: AdapterInfo[];
  issues: Array<{ path: string; message: string }>;
}> {
  return requestJson(
    `/api/project/${projectId}/adapters`,
    undefined,
    "Failed to fetch agent adapters",
  );
}

export async function sendToAgent(slug: string, text: string): Promise<{ slug: string }> {
  return requestJson(
    `/api/agent/${encodeURIComponent(slug)}/send`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    },
    `Failed to send to ${slug}`,
  );
}

/** Explicitly answer a recognized harness dialog; this never runs automatically. */
export async function respondToAgentDialog(slug: string, action: "accept" | "cancel"): Promise<{ slug: string }> {
  return requestJson(
    `/api/agent/${encodeURIComponent(slug)}/respond`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
    `Failed to respond to ${slug}`,
  );
}

export async function readAgentScreen(
  slug: string,
  options: { source?: "visible" | "scrollback"; lines?: number; ansi?: boolean } = {},
): Promise<{ slug: string; text: string }> {
  const params = new URLSearchParams();
  if (options.source) params.set("source", options.source);
  if (options.lines) params.set("lines", String(options.lines));
  if (options.ansi) params.set("ansi", "1");
  return requestJson(
    `/api/agent/${encodeURIComponent(slug)}/read?${params.toString()}`,
    undefined,
    `Failed to read ${slug}`,
  );
}

export async function stopAgent(slug: string): Promise<RunSummary> {
  return requestJson<RunSummary>(
    `/api/agent/${encodeURIComponent(slug)}/stop`,
    { method: "POST" },
    `Failed to stop ${slug}`,
  );
}

export interface CreateFeaturePayload {
  title: string;
  description?: string;
  category_id?: string;
  phase_ids?: string[];
  status?: "todo" | "in_progress" | "blocked" | "done";
  create_todo?: boolean;
}

export interface UpdateFeaturePayload {
  title?: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done";
  category_id?: string;
}

export interface CreateTodoPayload {
  title: string;
  description?: string;
  status?: "todo" | "in_progress" | "blocked" | "done";
  related_feature_item_ids?: string[];
  related_asset_ids?: string[];
  creates_feature?: boolean;
  category_id?: string;
  phase_ids?: string[];
  imminent?: boolean;
}

export async function createProjectFeatureCategory(
  id: string,
  title: string,
): Promise<{ category_id: string }> {
  return requestJson(
    `/api/project/${id}/features/categories`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
    `Failed to create feature category for ${id}`,
  );
}

export async function createProjectFeaturePhase(
  id: string,
  title: string,
): Promise<{ phase_id: string }> {
  return requestJson(
    `/api/project/${id}/features/phases`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
    `Failed to create feature phase for ${id}`,
  );
}

export async function reorderProjectFeaturePhases(
  id: string,
  phaseIds: string[],
): Promise<{ phase_ids: string[] }> {
  return requestJson(
    `/api/project/${id}/features/phases`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase_ids: phaseIds }),
    },
    `Failed to reorder feature phases for ${id}`,
  );
}

export async function saveProjectFeaturePhases(
  id: string,
  phases: Array<{ id?: string; title: string }>,
): Promise<{ phases: Array<{ id: string; title: string }> }> {
  return requestJson(
    `/api/project/${id}/features/phases`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phases }),
    },
    `Failed to save feature phases for ${id}`,
  );
}

export async function updateProjectFeaturePhases(
  id: string,
  featureId: string,
  phaseIds: string[],
): Promise<{ feature_item_id: string; phase_ids: string[] }> {
  return requestJson(
    `/api/project/${id}/features/${encodeURIComponent(featureId)}/phases`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase_ids: phaseIds }),
    },
    `Failed to update feature phases for ${id}`,
  );
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

export async function updateProjectFeature(
  id: string,
  featureId: string,
  payload: UpdateFeaturePayload,
): Promise<{ feature_item_id: string; category_id: string }> {
  return requestJson<{ feature_item_id: string; category_id: string }>(
    `/api/project/${id}/features/${encodeURIComponent(featureId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to update feature ${featureId} for ${id}`,
  );
}

export async function createProjectTodo(
  id: string,
  payload: CreateTodoPayload,
): Promise<{ todo_id: string; feature_item_id: string | null }> {
  return requestJson(
    `/api/project/${id}/todos`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    `Failed to create to-do for ${id}`,
  );
}

export async function updateProjectTodo(
  id: string,
  todoId: string,
  payload: Partial<Pick<CreateTodoPayload, "status" | "related_feature_item_ids" | "related_asset_ids" | "creates_feature" | "imminent">>,
): Promise<{ todo_id: string }> {
  return requestJson(
    `/api/project/${id}/todos/${encodeURIComponent(todoId)}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    `Failed to update to-do for ${id}`,
  );
}

export interface DecisionPayload {
  title?: string;
  question?: string;
  context?: string;
  kind?: DecisionKind;
  /** Problem description; required when `kind` is "open_ended". */
  problem?: string;
  impact?: DecisionImpact;
  owner?: string | null;
  options?: Array<{
    id?: string;
    title: string;
    description?: string;
    consequences?: string;
    creates_features?: DecisionFeatureDraft[];
  }>;
  feature_item_ids?: string[];
}

export interface ResolveDecisionPayload {
  /** One of the decision's options; omitted for open-ended decisions. */
  option_id?: string;
  /** Free-text resolution for open-ended decisions. */
  answer?: string;
  rationale?: string;
  create_features?: DecisionFeatureDraft[];
  handoff?: {
    profile_id?: string;
    prompt: string;
    prompt_packs?: string[];
    feature_item_id?: string | null;
    worktree?: boolean;
  };
}

export interface ResolveDecisionResult {
  decision: Decision;
  run: RunSummary | null;
  /** Set when the decision resolved but the agent hand-off could not start. */
  handoff_error?: string;
}

export async function fetchProjectDecisions(id: string): Promise<Decision[]> {
  const result = await requestJson<{ decisions: Decision[] }>(
    `/api/project/${id}/decisions`,
    undefined,
    `Failed to fetch decisions for ${id}`,
  );
  return result.decisions;
}

export async function createProjectDecision(id: string, payload: DecisionPayload): Promise<Decision> {
  const result = await requestJson<{ decision: Decision }>(
    `/api/project/${id}/decisions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to create decision for ${id}`,
  );
  return result.decision;
}

export async function updateProjectDecision(id: string, decisionId: string, payload: DecisionPayload): Promise<Decision> {
  const result = await requestJson<{ decision: Decision }>(
    `/api/project/${id}/decisions/${encodeURIComponent(decisionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to update decision ${decisionId}`,
  );
  return result.decision;
}

export async function resolveProjectDecision(
  id: string,
  decisionId: string,
  payload: ResolveDecisionPayload,
): Promise<ResolveDecisionResult> {
  return requestJson<ResolveDecisionResult>(
    `/api/project/${id}/decisions/${encodeURIComponent(decisionId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    `Failed to resolve decision ${decisionId}`,
  );
}

export async function fetchHostHealth(): Promise<HostHealth> {
  return requestJson<HostHealth>("/api/host/health", undefined, "Failed to fetch host health");
}

export type SkillSource = "npm" | "github";

export interface SkillLink {
  source: SkillSource;
  url: string;
  name: string;
  version?: string;
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
  payload: { source: SkillSource; url: string },
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

export interface AssetWorkspaceData {
  settings: AssetManagerConfig;
  library: AssetLibrary;
}

export interface AssetUploadPayload {
  file_name: string;
  media_type?: string;
  content_base64?: string;
  source_project_path?: string;
  variation_name?: string;
  used?: boolean;
}

export async function fetchAssetWorkspace(id: string): Promise<AssetWorkspaceData> {
  return requestJson<AssetWorkspaceData>(
    `/api/project/${id}/assets`,
    undefined,
    `Failed to fetch assets for ${id}`,
  );
}

export async function saveAssetSettings(
  id: string,
  settings: AssetManagerConfig,
): Promise<AssetWorkspaceData> {
  return requestJson<AssetWorkspaceData>(
    `/api/project/${id}/assets/settings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    },
    `Failed to save asset settings for ${id}`,
  );
}

export async function createAssetCategory(
  id: string,
  payload: {
    title: string;
    parent_id?: string | null;
    color?: AssetBucket["color"];
    preset?: AssetManagerConfig["preset"];
    instruction?: string;
    path?: string | null;
    accepted_types?: string[];
    prevent_agent_uploads?: boolean;
    metadata?: AssetMetadata;
  },
): Promise<void> {
  await requestJson(`/api/project/${id}/assets/buckets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "Failed to create asset category");
}

export async function updateAssetCategorySettings(
  id: string,
  categoryId: string,
  settings: { prevent_agent_uploads?: boolean; color?: AssetBucket["color"] },
): Promise<void> {
  await requestJson(`/api/project/${id}/assets/buckets/${encodeURIComponent(categoryId)}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }, "Failed to update category settings");
}

export async function deleteAssetCategory(id: string, categoryId: string): Promise<{ moved_assets: number; deleted_folders: number }> {
  return requestJson(`/api/project/${id}/assets/buckets/${encodeURIComponent(categoryId)}`, {
    method: "DELETE",
  }, "Failed to delete asset folder");
}

export async function moveAssetCategory(id: string, categoryId: string, parentId: string | null): Promise<void> {
  await requestJson(`/api/project/${id}/assets/buckets/${encodeURIComponent(categoryId)}/parent`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent_id: parentId }),
  }, "Failed to move asset folder");
}

export async function moveManagedAssetRequest(id: string, assetId: string, bucketId: string): Promise<void> {
  await requestJson(`/api/project/${id}/assets/items/${encodeURIComponent(assetId)}/bucket`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_id: bucketId }),
  }, "Failed to move asset");
}

export async function updateAssetCategoryMetadata(
  id: string,
  categoryId: string,
  metadata: AssetMetadata,
): Promise<void> {
  await requestJson(`/api/project/${id}/assets/buckets/${encodeURIComponent(categoryId)}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  }, "Failed to update category metadata");
}

export async function uploadManagedAsset(
  id: string,
  payload: {
    bucket_id: string;
    name: string;
    metadata: AssetMetadata;
    upload: AssetUploadPayload;
  },
): Promise<ManagedAsset> {
  return requestJson<ManagedAsset>(`/api/project/${id}/assets/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "Failed to upload asset");
}

export async function uploadAssetVariation(
  id: string,
  assetId: string,
  payload: AssetUploadPayload,
): Promise<AssetVariation> {
  return requestJson<AssetVariation>(
    `/api/project/${id}/assets/items/${encodeURIComponent(assetId)}/variations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    "Failed to upload asset variation",
  );
}

export async function setAssetVariationUsage(
  id: string,
  assetId: string,
  variationId: string,
  used: boolean,
): Promise<void> {
  await requestJson(
    `/api/project/${id}/assets/items/${encodeURIComponent(assetId)}/variations/${encodeURIComponent(variationId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ used }),
    },
    "Failed to update asset variation",
  );
}

export async function deleteAssetVariationRequest(
  id: string,
  assetId: string,
  variationId: string,
): Promise<void> {
  await requestJson(
    `/api/project/${id}/assets/items/${encodeURIComponent(assetId)}/variations/${encodeURIComponent(variationId)}`,
    { method: "DELETE" },
    "Failed to delete asset variation",
  );
}

export async function updateAssetMetadata(
  id: string,
  assetId: string,
  metadata: AssetMetadata,
): Promise<void> {
  await requestJson(`/api/project/${id}/assets/items/${encodeURIComponent(assetId)}/metadata`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  }, "Failed to update asset metadata");
}

export async function deleteManagedAssetRequest(id: string, assetId: string): Promise<void> {
  await requestJson(
    `/api/project/${id}/assets/items/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
    "Failed to delete asset",
  );
}

// ---- project files ---------------------------------------------------------

export interface ProjectFileEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number | null;
}

export async function fetchProjectDocs(id: string): Promise<string[]> {
  const data = await requestJson<{ files: string[] }>(`/api/project/${id}/docs`, undefined, "Failed to list docs");
  return data.files;
}

export async function fetchProjectFiles(id: string, path = ""): Promise<{ path: string; entries: ProjectFileEntry[] }> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return requestJson(`/api/project/${id}/files${query}`, undefined, "Failed to list files");
}

export async function searchProjectFiles(id: string, query: string): Promise<ProjectFileEntry[]> {
  const data = await requestJson<{ files: ProjectFileEntry[] }>(
    `/api/project/${id}/files/search?q=${encodeURIComponent(query)}`,
    undefined,
    "Failed to search files",
  );
  return data.files;
}

/** URL of a repo file's raw bytes; usable as an <img>/<iframe> src. */
export function projectFileUrl(id: string, path: string): string {
  return `/api/project/${id}/file?path=${encodeURIComponent(path)}`;
}

/** Fetch a repo file as text. Throws ApiError (413 for oversized files). */
export async function fetchProjectFileText(id: string, path: string): Promise<string> {
  const res = await fetch(projectFileUrl(id, path));
  if (!res.ok) {
    const payload = (safeJsonParse(await res.text()) ?? {}) as ApiErrorPayload;
    throw new ApiError(payload.error ?? "Failed to read file", { status: res.status, code: payload.code ?? null });
  }
  return res.text();
}

// ---- previews and customer reviews -------------------------------------------

export type PublicReviewSession = Omit<ReviewSession, "token_hash">;

export interface ProjectReviews {
  sessions: PublicReviewSession[];
  requests: ChangeRequest[];
  previews: PreviewInstance[];
}

export interface CustomerReviewData {
  session: PublicReviewSession;
  project_name: string;
  preview: {
    status: PreviewStatus | "missing";
    port: number | null;
    /** Same-origin proxy path when the session is proxied; null means use the port directly. */
    url: string | null;
    access?: "direct" | "proxied";
  };
  requests: ChangeRequest[];
}

export async function fetchProjectReviews(id: string): Promise<ProjectReviews> {
  return requestJson(`/api/project/${id}/reviews`, undefined, "Failed to load reviews");
}

export async function fetchProjectBranches(id: string): Promise<GitBranch[]> {
  const data = await requestJson<{ branches: GitBranch[] }>(`/api/project/${id}/branches`, undefined, "Failed to list branches");
  return data.branches;
}

export async function fetchProjectPreviews(id: string): Promise<PreviewInstance[]> {
  const data = await requestJson<{ previews: PreviewInstance[] }>(`/api/project/${id}/previews`, undefined, "Failed to list previews");
  return data.previews;
}

export async function startPreview(id: string, branch: string): Promise<PreviewInstance> {
  return requestJson(`/api/project/${id}/previews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, source: "dashboard" }),
  }, "Failed to start preview");
}

export async function stopPreview(id: string, previewId: string, removeWorktree = false): Promise<PreviewInstance> {
  return requestJson(`/api/project/${id}/previews/${encodeURIComponent(previewId)}/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remove_worktree: removeWorktree }),
  }, "Failed to stop preview");
}

export async function fetchPreviewScreen(id: string, previewId: string): Promise<string> {
  const data = await requestJson<{ screen: string }>(
    `/api/project/${id}/previews/${encodeURIComponent(previewId)}/screen`, undefined, "Failed to read preview output",
  );
  return data.screen;
}

export async function createReviewSession(
  id: string,
  input: ReviewSessionCreate,
): Promise<{ session: PublicReviewSession; token: string }> {
  return requestJson(`/api/project/${id}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Failed to create review link");
}

export async function revokeReviewSession(id: string, sessionId: string): Promise<PublicReviewSession> {
  const data = await requestJson<{ session: PublicReviewSession }>(
    `/api/project/${id}/reviews/${encodeURIComponent(sessionId)}/revoke`, { method: "POST" }, "Failed to revoke review link",
  );
  return data.session;
}

export async function updateChangeRequest(id: string, requestId: string, status: ChangeRequestStatus): Promise<ChangeRequest> {
  const data = await requestJson<{ request: ChangeRequest }>(
    `/api/project/${id}/reviews/requests/${encodeURIComponent(requestId)}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) },
    "Failed to update change request",
  );
  return data.request;
}

export async function fetchCustomerReview(token: string): Promise<CustomerReviewData> {
  return requestJson(`/api/review/${encodeURIComponent(token)}`, undefined, "This review link is not available");
}

export async function submitChangeRequest(token: string, input: ChangeRequestSubmit): Promise<ChangeRequest> {
  const data = await requestJson<{ request: ChangeRequest }>(`/api/review/${encodeURIComponent(token)}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }, "Failed to send change request");
  return data.request;
}

/** The browser-facing URL of a preview: the proxy path, or the dashboard's own hostname with the preview port. */
export function previewBrowserUrl(preview: { url: string | null; port: number | null }, path = "/"): string | null {
  if (preview.url) return `${preview.url.replace(/\/$/, "")}${path}`;
  if (preview.port) return `${window.location.protocol}//${window.location.hostname}:${preview.port}${path}`;
  return null;
}

// ---- host ports -----------------------------------------------------------------

export const HOST_SCOPE: ConfigurationScope = { type: "host", id: "local", label: "Host machine", projectIds: [] };

export async function fetchHostPortSettings(): Promise<PortSettings> {
  return (await fetchConfiguration(HOST_SCOPE)).settings.ports;
}

export async function saveHostPortSettings(ports: PortSettings): Promise<PortSettings> {
  const state = await requestJson<ConfigurationState>(`${configurationBase(HOST_SCOPE)}/ports`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ports),
  }, "Failed to save port settings");
  return state.settings.ports;
}

export async function fetchHostFeatureFlags(): Promise<FeatureFlags> {
  return (await fetchConfiguration(HOST_SCOPE)).settings.features;
}

export const FEATURE_FLAGS_CHANGED_EVENT = "konductor:feature-flags-changed";

export async function saveHostFeatureFlags(features: FeatureFlags): Promise<FeatureFlags> {
  const state = await requestJson<ConfigurationState>(`${configurationBase(HOST_SCOPE)}/features`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(features),
  }, "Failed to save feature settings");
  window.dispatchEvent(new Event(FEATURE_FLAGS_CHANGED_EVENT));
  return state.settings.features;
}
