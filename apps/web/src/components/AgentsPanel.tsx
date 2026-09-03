import React, {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchHostHealth,
  fetchProjectAgents,
  fetchRunTerminal,
  formatApiError,
  installSkillPackage,
  saveProjectAgentsWorkspace,
  searchSkillRegistry,
  startProjectRun,
  stopProjectRun,
  type AgentData,
  type AgentWorkspaceConfig,
  type HostHealth,
  type NpmSkillSearchResult,
  type SkillInstallResult,
} from "../lib/registry.js";
import type {
  AgentProfile,
  KonductorConfig,
  ProjectToken,
  ProjectTokensFile,
  PromptPack,
  RunSummary,
  SkillProfile,
  TokenProvider,
} from "../lib/types.js";

type AgentRunner = AgentProfile["runner"];

type ProfileDraft = {
  title: string;
  runner: AgentRunner;
  model: string;
  binary: string;
  args: string;
  token_id: string;
  api_base: string;
  temperature: string;
  default_mcp: boolean;
  default_working_dir: "project_root" | "current";
};

type PromptPackDraft = {
  title: string;
  instructions: string;
  file_refs: string;
  mcp_reminder: string;
};

const MODEL_OPTIONS: Record<AgentRunner, string[]> = {
  claude_code: ["sonnet", "opus", "fable", "claude-sonnet-4-20250514"],
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
  minimax: ["minimax-1", "minimax-m1", "minimax-text-01"],
};

const s: Record<string, React.CSSProperties> = {
  page: { display: "grid", gap: 18 },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  },
  heroCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 14,
    padding: 16,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.82) 100%)",
    boxShadow: "var(--shadow-soft)",
  },
  heroValue: {
    fontSize: 26,
    lineHeight: 1,
    fontWeight: 700,
    color: "var(--text-primary)",
    marginBottom: 6,
  },
  heroTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "var(--text-tertiary)",
    marginBottom: 8,
  },
  heroText: {
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
  },
  section: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
  },
  sectionHeader: {
    padding: "12px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    background:
      "linear-gradient(90deg, rgba(15, 118, 110, 0.05) 0%, rgba(2, 132, 199, 0.03) 100%)",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-tertiary)",
  },
  sectionBody: {
    padding: 16,
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.08fr) minmax(360px, 0.92fr)",
    gap: 18,
    alignItems: "start",
  },
  stack: {
    display: "grid",
    gap: 18,
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  workspaceGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: 14,
    alignItems: "start",
  },
  panelCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 14,
    background: "var(--bg-panel)",
    padding: 14,
    display: "grid",
    gap: 12,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  panelText: {
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    marginBottom: 6,
  },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    fontSize: 13,
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    fontSize: 13,
  },
  textarea: {
    width: "100%",
    minHeight: 120,
    padding: 12,
    borderRadius: 12,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    resize: "vertical",
    fontSize: 13,
    lineHeight: 1.55,
  },
  checks: {
    display: "grid",
    gap: 8,
  },
  checkRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13,
    color: "var(--text-primary)",
  },
  actionsRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  primaryButton: {
    border: "none",
    background: "linear-gradient(135deg, #0f766e 0%, #0284c7 100%)",
    color: "white",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  button: {
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  subtleButton: {
    border: "1px dashed var(--border-subtle)",
    background: "transparent",
    color: "var(--text-secondary)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  dangerButton: {
    border: "1px solid rgba(185, 28, 28, 0.2)",
    background: "rgba(185, 28, 28, 0.08)",
    color: "var(--danger)",
    borderRadius: 10,
    padding: "8px 12px",
    fontSize: 12,
    cursor: "pointer",
  },
  callout: {
    borderRadius: 12,
    padding: "10px 12px",
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
  },
  calloutTitle: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  },
  helper: {
    fontSize: 12,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  },
  error: {
    fontSize: 12,
    color: "var(--danger)",
    whiteSpace: "pre-wrap",
  },
  empty: {
    fontSize: 13,
    color: "var(--text-tertiary)",
  },
  itemList: {
    display: "grid",
    gap: 10,
  },
  itemCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 12,
    background: "var(--bg-canvas)",
    padding: 12,
    display: "grid",
    gap: 8,
  },
  itemHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "flex-start",
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  itemMeta: {
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  },
  tagRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  tag: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(15, 118, 110, 0.08)",
    color: "#0f766e",
    border: "1px solid rgba(15, 118, 110, 0.16)",
  },
  tokenTable: {
    display: "grid",
    gap: 8,
  },
  tokenRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.7fr) minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    border: "1px solid var(--border-subtle)",
    borderRadius: 12,
    padding: "10px 12px",
    background: "var(--bg-canvas)",
  },
  tokenMono: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "var(--text-secondary)",
  },
  searchGrid: {
    display: "grid",
    gap: 10,
  },
  runCard: {
    border: "1px solid var(--border-subtle)",
    borderRadius: 12,
    padding: 14,
    background: "var(--bg-panel)",
  },
  runHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 8,
  },
  badge: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 999,
    background: "var(--bg-canvas)",
    color: "var(--text-tertiary)",
  },
  terminal: {
    background: "#081018",
    color: "#d3deea",
    borderRadius: 12,
    padding: 14,
    minHeight: 360,
    maxHeight: "58vh",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowX: "auto",
    overflowY: "auto",
    scrollbarGutter: "stable",
  },
  terminalMeta: {
    marginBottom: 10,
    color: "#9fb0c2",
  },
};

function splitRuns(runs: RunSummary[]): Pick<AgentData, "active_runs" | "past_runs"> {
  return {
    active_runs: runs.filter((run) => run.status === "running" || run.status === "queued"),
    past_runs: runs.filter((run) => run.status !== "running" && run.status !== "queued"),
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueId(existing: Iterable<string>, base: string, fallback: string): string {
  const taken = new Set(existing);
  const root = slugify(base) || fallback;
  let candidate = root;
  let index = 2;
  while (taken.has(candidate)) {
    candidate = `${root}-${index}`;
    index += 1;
  }
  return candidate;
}

function parseArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFileRefs(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

function providerLabel(runner: AgentRunner): string {
  switch (runner) {
    case "claude_code":
      return "Claude Code";
    case "openai":
      return "OpenAI";
    case "minimax":
      return "Minimax";
  }
}

function projectTokenProviderLabel(provider: TokenProvider): string {
  return provider === "openai" ? "OpenAI" : "Minimax";
}

function defaultProfileDraft(): ProfileDraft {
  return {
    title: "",
    runner: "claude_code",
    model: "sonnet",
    binary: "claude",
    args: "",
    token_id: "",
    api_base: "",
    temperature: "0.2",
    default_mcp: true,
    default_working_dir: "project_root",
  };
}

function defaultPromptPackDraft(): PromptPackDraft {
  return {
    title: "",
    instructions: "",
    file_refs: "",
    mcp_reminder: "",
  };
}

function defaultTokensFile(): ProjectTokensFile {
  return {
    schema_version: "0.2.0",
    tokens: [],
  };
}

function normalizeAgents(config: KonductorConfig | null): AgentWorkspaceConfig {
  const tasks = config?.agents?.tasks;
  return {
    default_profile: config?.agents?.default_profile ?? "default-profile",
    profiles: config?.agents?.profiles ?? [],
    prompt_packs: config?.agents?.prompt_packs ?? [],
    skill_profiles: config?.agents?.skill_profiles ?? [],
    ...(tasks ? { tasks } : {}),
  };
}

function buildNextProfile(
  draft: ProfileDraft,
  profiles: AgentProfile[],
): AgentProfile {
  const title = draft.title.trim();
  if (!title) {
    throw new Error("Profile title is required.");
  }

  const id = uniqueId(
    profiles.map((profile) => profile.id),
    title,
    draft.runner === "claude_code" ? "claude-profile" : `${draft.runner}-profile`,
  );

  if (draft.runner === "claude_code") {
    return {
      id,
      title,
      runner: "claude_code",
      model: draft.model.trim() || undefined,
      binary: draft.binary.trim() || "claude",
      args: parseArgs(draft.args),
      default_mcp: draft.default_mcp,
      default_working_dir: draft.default_working_dir,
      default_env: {},
      telemetry: {
        provider: "opentelemetry",
        mode: "collector",
      },
    };
  }

  if (!draft.token_id) {
    throw new Error("Choose a project token for API-backed agent profiles.");
  }

  const temperature = Number.parseFloat(draft.temperature);
  if (Number.isNaN(temperature) || temperature < 0 || temperature > 2) {
    throw new Error("Temperature must be a number between 0 and 2.");
  }

  return {
    id,
    title,
    runner: draft.runner,
    model: draft.model.trim() || (draft.runner === "openai" ? "gpt-4.1-mini" : "minimax-1"),
    api_base: draft.api_base.trim() || undefined,
    api_key_env: draft.runner === "openai" ? "OPENAI_API_KEY" : "MINIMAX_API_KEY",
    token_id: draft.token_id,
    temperature,
    default_mcp: draft.default_mcp,
    default_working_dir: draft.default_working_dir,
    default_env: {},
    telemetry: {
      provider: draft.runner,
      mode: "responses",
    },
  };
}

function buildPromptPack(draft: PromptPackDraft, promptPacks: PromptPack[]): PromptPack {
  const title = draft.title.trim();
  const instructions = draft.instructions.trim();
  if (!title || !instructions) {
    throw new Error("Prompt pack title and instructions are required.");
  }

  return {
    id: uniqueId(promptPacks.map((pack) => pack.id), title, "prompt-pack"),
    title,
    instructions,
    file_refs: parseFileRefs(draft.file_refs),
    mcp_reminder: draft.mcp_reminder.trim() || undefined,
  };
}

function buildSkillProfile(result: NpmSkillSearchResult, existing: SkillProfile[]): SkillProfile {
  const pkg = result.package;
  const homepage = pkg.links?.homepage ?? pkg.links?.repository ?? pkg.links?.npm;
  return {
    id: uniqueId(existing.map((skill) => skill.id), pkg.name, "skill-profile"),
    title: pkg.name,
    source: "npm",
    package_name: pkg.name,
    description: pkg.description,
    homepage,
    registry_url: pkg.links?.npm,
    latest_version: pkg.version,
    install_command: `npm install ${pkg.name}@${pkg.version}`,
    keywords: pkg.keywords ?? [],
  };
}

interface AgentsPanelProps {
  projectId: string;
  config: KonductorConfig | null;
  initialRuns: RunSummary[];
  refreshToken: number;
  onDataChange: () => Promise<void>;
}

export function AgentsPanel({
  projectId,
  config,
  initialRuns,
  refreshToken,
  onDataChange,
}: AgentsPanelProps) {
  const [agentData, setAgentData] = useState<AgentData>({
    config,
    tokens: defaultTokensFile(),
    ...splitRuns(initialRuns),
  });
  const [selectedProfileId, setSelectedProfileId] = useState(
    config?.agents?.default_profile ?? "default-profile",
  );
  const [selectedPacks, setSelectedPacks] = useState<string[]>(
    config?.agents?.prompt_packs.slice(0, 1).map((pack) => pack.id) ?? [],
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [terminal, setTerminal] = useState<{ run: RunSummary; log: string } | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);
  const [tokenTitle, setTokenTitle] = useState("");
  const [tokenProvider, setTokenProvider] = useState<TokenProvider>("openai");
  const [tokenValue, setTokenValue] = useState("");
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(defaultProfileDraft());
  const [promptPackDraft, setPromptPackDraft] = useState<PromptPackDraft>(defaultPromptPackDraft());
  const [skillQuery, setSkillQuery] = useState("");
  const deferredSkillQuery = useDeferredValue(skillQuery.trim());
  const [skillResults, setSkillResults] = useState<NpmSkillSearchResult[]>([]);
  const [skillSearchMessage, setSkillSearchMessage] = useState<string | null>(null);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<SkillInstallResult | null>(null);

  useEffect(() => {
    Promise.all([fetchProjectAgents(projectId), fetchHostHealth()])
      .then(([data, health]) => {
        setAgentData(data);
        setHostHealth(health);
        setSelectedProfileId(data.config?.agents?.default_profile ?? "default-profile");
        setSelectedPacks((current) => {
          if (current.length > 0) return current;
          return data.config?.agents?.prompt_packs.slice(0, 1).map((pack) => pack.id) ?? [];
        });
        const nextRun = data.active_runs[0]?.id ?? data.past_runs[0]?.id ?? null;
        setSelectedRunId((current) => current ?? nextRun);
      })
      .catch((event) => setError(formatApiError(event)));
  }, [projectId, refreshToken]);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const data = await fetchRunTerminal(selectedRunId);
        if (cancelled) return;
        setTerminal(data);
        setTerminalError(null);
      } catch (event) {
        if (!cancelled) setTerminalError(formatApiError(event));
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, 1500);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (deferredSkillQuery.length < 2) {
      setSkillResults([]);
      setSkillSearchMessage(
        deferredSkillQuery.length === 0 ? "Search npm to turn packages into project skill profiles." : null,
      );
      return;
    }

    let cancelled = false;
    setSkillSearchMessage("Searching npm registry...");
    searchSkillRegistry(deferredSkillQuery)
      .then((response) => {
        if (cancelled) return;
        startTransition(() => {
          setSkillResults(response.objects ?? []);
          setSkillSearchMessage(
            (response.objects ?? []).length === 0 ? "No npm packages matched that query." : null,
          );
        });
      })
      .catch((event) => {
        if (!cancelled) {
          setSkillSearchMessage(formatApiError(event));
          setSkillResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredSkillQuery]);

  const agents = normalizeAgents(agentData.config);
  const profiles = agents.profiles ?? [];
  const promptPacks = agents.prompt_packs ?? [];
  const skillProfiles = agents.skill_profiles ?? [];
  const tokensFile = agentData.tokens ?? defaultTokensFile();
  const visibleRuns = useMemo(
    () => [...agentData.active_runs, ...agentData.past_runs],
    [agentData.active_runs, agentData.past_runs],
  );
  const selectedRun = terminal?.run ?? visibleRuns.find((run) => run.id === selectedRunId) ?? null;
  const selectedRunNeedsStatusWarning =
    selectedRun?.status === "succeeded" && selectedRun.status_write_count === 0;
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;
  const matchingTokens = tokensFile.tokens.filter((token) => token.provider === profileDraft.runner);

  useEffect(() => {
    if (selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)) return;
    if (profiles.length > 0) {
      setSelectedProfileId(profiles[0]!.id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    const validPackIds = new Set(promptPacks.map((pack) => pack.id));
    const current = selectedPacks.filter((id) => validPackIds.has(id));
    if (current.length === selectedPacks.length) return;
    setSelectedPacks(current.length > 0 ? current : promptPacks.slice(0, 1).map((pack) => pack.id));
  }, [promptPacks, selectedPacks]);

  useEffect(() => {
    if (profileDraft.runner === "claude_code") return;
    if (matchingTokens.some((token) => token.id === profileDraft.token_id)) return;
    setProfileDraft((current) => ({
      ...current,
      token_id: matchingTokens[0]?.id ?? "",
    }));
  }, [matchingTokens, profileDraft.runner, profileDraft.token_id]);

  function tokenUsage(tokenId: string): AgentProfile[] {
    return profiles.filter(
      (profile): profile is Extract<AgentProfile, { runner: "openai" | "minimax" }> =>
        profile.runner !== "claude_code" && profile.token_id === tokenId,
    );
  }

  async function persistWorkspace(
    nextAgents: AgentWorkspaceConfig,
    nextTokens: ProjectTokensFile,
    successMessage: string,
  ) {
    setWorkspaceSaving(true);
    setError(null);
    setWorkspaceMessage("Saving agent workspace...");
    try {
      const data = await saveProjectAgentsWorkspace(projectId, {
        agents: nextAgents,
        tokens: nextTokens,
      });
      setAgentData(data);
      setSelectedProfileId(data.config?.agents?.default_profile ?? selectedProfileId);
      setWorkspaceMessage(successMessage);
    } catch (event) {
      setError(formatApiError(event));
      setWorkspaceMessage(null);
    } finally {
      setWorkspaceSaving(false);
    }
  }

  async function handleStart() {
    if (!prompt.trim()) {
      setError("Enter a prompt before starting a run.");
      return;
    }
    if (!selectedProfile) {
      setError("Create at least one agent profile before launching a run.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setLaunchMessage("Checking Konductor host availability...");
    try {
      const health = await fetchHostHealth();
      setHostHealth(health);
      if (!health.running) {
        setError(
          `${health.error ?? "Konductor host is not running."}${health.hint ? `\nHint: ${health.hint}` : ""}`,
        );
        setLaunchMessage(null);
        return;
      }
      setLaunchMessage("Sending run request to Konductor host...");
      const run = await startProjectRun(projectId, {
        profile_id: selectedProfileId,
        prompt,
        prompt_packs: selectedPacks,
        source: "dashboard",
      });
      setSelectedRunId(run.id);
      setPrompt("");
      await onDataChange();
      const refreshed = await fetchProjectAgents(projectId);
      setAgentData(refreshed);
      setLaunchMessage(
        `Run ${run.id} started with ${selectedProfile.title}. Terminal output will appear below as soon as the process writes output.`,
      );
    } catch (event) {
      setError(formatApiError(event));
      setLaunchMessage(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStop(runId: string) {
    try {
      setLaunchMessage(`Stopping run ${runId}...`);
      await stopProjectRun(runId);
      await onDataChange();
      const refreshed = await fetchProjectAgents(projectId);
      setAgentData(refreshed);
      setLaunchMessage(`Run ${runId} was stopped.`);
    } catch (event) {
      setError(formatApiError(event));
      setLaunchMessage(null);
    }
  }

  async function handleAddToken() {
    const title = tokenTitle.trim();
    const token = tokenValue.trim();
    if (!title || !token) {
      setError("Token title and token value are required.");
      return;
    }
    const nextTokens: ProjectTokensFile = {
      schema_version: "0.2.0",
      tokens: [
        ...tokensFile.tokens,
        {
          id: uniqueId(tokensFile.tokens.map((item) => item.id), title, `${tokenProvider}-token`),
          title,
          provider: tokenProvider,
          token,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };
    await persistWorkspace(agents, nextTokens, `Saved token "${title}".`);
    setTokenTitle("");
    setTokenValue("");
  }

  async function handleDeleteToken(tokenEntry: ProjectToken) {
    const usage = tokenUsage(tokenEntry.id);
    if (usage.length > 0) {
      setError(
        `Token "${tokenEntry.title}" is still used by: ${usage.map((profile) => profile.title).join(", ")}.`,
      );
      return;
    }
    const nextTokens: ProjectTokensFile = {
      schema_version: "0.2.0",
      tokens: tokensFile.tokens.filter((token) => token.id !== tokenEntry.id),
    };
    await persistWorkspace(agents, nextTokens, `Removed token "${tokenEntry.title}".`);
  }

  async function handleAddProfile() {
    try {
      const nextProfile = buildNextProfile(profileDraft, profiles);
      const nextProfiles = [...profiles, nextProfile];
      const nextAgents: AgentWorkspaceConfig = {
        ...agents,
        default_profile: profiles.length === 0 ? nextProfile.id : agents.default_profile,
        profiles: nextProfiles,
        prompt_packs: promptPacks,
        skill_profiles: skillProfiles,
      };
      await persistWorkspace(nextAgents, tokensFile, `Added agent profile "${nextProfile.title}".`);
      setProfileDraft(defaultProfileDraft());
    } catch (event) {
      setError(event instanceof Error ? event.message : String(event));
    }
  }

  async function handleDeleteProfile(profileId: string) {
    if (profiles.length <= 1) {
      setError("Konductor requires at least one agent profile.");
      return;
    }
    const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
    const nextDefault =
      agents.default_profile === profileId ? nextProfiles[0]!.id : agents.default_profile;
    const nextAgents: AgentWorkspaceConfig = {
      ...agents,
      default_profile: nextDefault,
      profiles: nextProfiles,
      prompt_packs: promptPacks,
      skill_profiles: skillProfiles,
    };
    await persistWorkspace(nextAgents, tokensFile, "Removed agent profile.");
  }

  async function handleSetDefaultProfile(profileId: string) {
    const nextAgents: AgentWorkspaceConfig = {
      ...agents,
      default_profile: profileId,
      profiles,
      prompt_packs: promptPacks,
      skill_profiles: skillProfiles,
    };
    await persistWorkspace(nextAgents, tokensFile, "Updated default agent profile.");
  }

  async function handleAddPromptPack() {
    try {
      const nextPack = buildPromptPack(promptPackDraft, promptPacks);
      const nextPacks = [...promptPacks, nextPack];
      const nextAgents: AgentWorkspaceConfig = {
        ...agents,
        profiles,
        prompt_packs: nextPacks,
        skill_profiles: skillProfiles,
      };
      await persistWorkspace(nextAgents, tokensFile, `Added prompt pack "${nextPack.title}".`);
      setPromptPackDraft(defaultPromptPackDraft());
    } catch (event) {
      setError(event instanceof Error ? event.message : String(event));
    }
  }

  async function handleDeletePromptPack(packId: string) {
    if (promptPacks.length <= 1) {
      setError("Keep at least one prompt pack so runs always have a default operating context.");
      return;
    }
    const nextPacks = promptPacks.filter((pack) => pack.id !== packId);
    const nextAgents: AgentWorkspaceConfig = {
      ...agents,
      profiles,
      prompt_packs: nextPacks,
      skill_profiles: skillProfiles,
    };
    await persistWorkspace(nextAgents, tokensFile, "Removed prompt pack.");
  }

  async function handleAddSkill(result: NpmSkillSearchResult) {
    const nextSkill = buildSkillProfile(result, skillProfiles);
    const nextAgents: AgentWorkspaceConfig = {
      ...agents,
      profiles,
      prompt_packs: promptPacks,
      skill_profiles: [...skillProfiles, nextSkill],
    };
    await persistWorkspace(nextAgents, tokensFile, `Added skill profile "${nextSkill.title}".`);
  }

  async function handleDeleteSkill(skillId: string) {
    const nextAgents: AgentWorkspaceConfig = {
      ...agents,
      profiles,
      prompt_packs: promptPacks,
      skill_profiles: skillProfiles.filter((skill) => skill.id !== skillId),
    };
    await persistWorkspace(nextAgents, tokensFile, "Removed skill profile.");
  }

  async function handleInstallSkill(result: NpmSkillSearchResult) {
    try {
      setInstallingPackage(result.package.name);
      setInstallResult(null);
      const installed = await installSkillPackage(projectId, {
        package_name: result.package.name,
        version: result.package.version,
      });
      setInstallResult(installed);
    } catch (event) {
      setInstallResult({
        command: `npm install ${result.package.name}@${result.package.version}`,
        stdout: "",
        stderr: "",
        error: formatApiError(event),
      });
    } finally {
      setInstallingPackage(null);
    }
  }

  const hostMessage = hostHealth?.running
    ? `Host is running on port ${hostHealth.port}. Active runs: ${hostHealth.running_runs.length}.`
    : `${hostHealth?.error ?? "Konductor host is not running."}${hostHealth?.hint ? `\nHint: ${hostHealth.hint}` : ""}`;
  const hostTone = hostHealth?.running
    ? {
        borderColor: "rgba(15, 118, 110, 0.24)",
        background: "rgba(15, 118, 110, 0.08)",
      }
    : {
        borderColor: "rgba(185, 28, 28, 0.22)",
        background: "rgba(185, 28, 28, 0.08)",
      };

  return (
    <div style={s.page}>
      <div style={s.heroGrid}>
        <div style={{ ...s.heroCard, ...hostTone }}>
          <div style={s.heroTitle}>Host Status</div>
          <div style={s.heroValue}>{hostHealth?.running ? "Ready" : "Offline"}</div>
          <div style={s.heroText}>{hostMessage}</div>
        </div>
        <div style={s.heroCard}>
          <div style={s.heroTitle}>Agent Profiles</div>
          <div style={s.heroValue}>{profiles.length}</div>
          <div style={s.heroText}>
            Default: {profiles.find((profile) => profile.id === agents.default_profile)?.title ?? "Not set"}
          </div>
        </div>
        <div style={s.heroCard}>
          <div style={s.heroTitle}>Project Tokens</div>
          <div style={s.heroValue}>{tokensFile.tokens.length}</div>
          <div style={s.heroText}>
            Providers: {tokensFile.tokens.length === 0
              ? "No stored tokens yet."
              : Array.from(new Set(tokensFile.tokens.map((token) => projectTokenProviderLabel(token.provider)))).join(", ")}
          </div>
        </div>
        <div style={s.heroCard}>
          <div style={s.heroTitle}>Skills + Prompt Packs</div>
          <div style={s.heroValue}>{skillProfiles.length + promptPacks.length}</div>
          <div style={s.heroText}>
            {skillProfiles.length} skill profiles, {promptPacks.length} prompt packs
          </div>
        </div>
      </div>

      <div style={s.columns}>
        <div style={s.stack}>
          <section style={s.section}>
            <div style={s.sectionHeader}>Launch Agent</div>
            <div style={s.sectionBody}>
              <div style={s.stack}>
                <div style={s.fieldGrid}>
                  <div>
                    <span style={s.label}>Profile</span>
                    <select
                      style={s.select}
                      value={selectedProfileId}
                      onChange={(event) => setSelectedProfileId(event.target.value)}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.title} · {providerLabel(profile.runner)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span style={s.label}>Profile Model</span>
                    <input
                      style={s.input}
                      value={selectedProfile?.model ?? "Profile decides this at runtime"}
                      disabled
                    />
                  </div>
                </div>
                <div>
                  <span style={s.label}>Prompt Packs</span>
                  <div style={s.checks}>
                    {promptPacks.map((pack) => {
                      const checked = selectedPacks.includes(pack.id);
                      return (
                        <label key={pack.id} style={s.checkRow}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedPacks((current) => [...current, pack.id]);
                              } else {
                                setSelectedPacks((current) => current.filter((id) => id !== pack.id));
                              }
                            }}
                          />
                          <span>{pack.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <span style={s.label}>Prompt</span>
                  <textarea
                    style={s.textarea}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the task you want this agent to work on."
                  />
                </div>
                {error && <div style={s.error}>{error}</div>}
                {launchMessage && (
                  <div style={{ ...s.callout, borderColor: "rgba(2, 132, 199, 0.24)", background: "rgba(2, 132, 199, 0.08)" }}>
                    <span style={s.calloutTitle}>Run Status</span>
                    {launchMessage}
                  </div>
                )}
                <div style={s.actionsRow}>
                  <button style={s.primaryButton} disabled={submitting || profiles.length === 0} onClick={handleStart}>
                    {submitting ? "Starting…" : "Start agent"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section style={s.section}>
            <div style={s.sectionHeader}>Agent Workspace</div>
            <div style={s.sectionBody}>
              <div style={s.stack}>
                <div style={s.helper}>
                  This workspace manages project-local tokens, agent profiles, prompt packs, and skill profiles.
                  Tokens are stored in plain text at <code>.konductor/tokens.json</code> for now.
                </div>
                {workspaceMessage && (
                  <div style={{ ...s.callout, borderColor: "rgba(15, 118, 110, 0.24)", background: "rgba(15, 118, 110, 0.08)" }}>
                    <span style={s.calloutTitle}>Workspace</span>
                    {workspaceMessage}
                  </div>
                )}
                <div style={s.workspaceGrid}>
                  <div style={s.panelCard}>
                    <div style={s.panelTitle}>Token Vault</div>
                    <div style={s.panelText}>
                      Create project tokens once, then attach matching providers to OpenAI or Minimax agent profiles.
                    </div>
                    <div style={s.fieldGrid}>
                      <div>
                        <span style={s.label}>Token Label</span>
                        <input
                          style={s.input}
                          value={tokenTitle}
                          onChange={(event) => setTokenTitle(event.target.value)}
                          placeholder="Production OpenAI"
                        />
                      </div>
                      <div>
                        <span style={s.label}>Provider</span>
                        <select
                          style={s.select}
                          value={tokenProvider}
                          onChange={(event) => setTokenProvider(event.target.value as TokenProvider)}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="minimax">Minimax</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <span style={s.label}>Token</span>
                      <input
                        style={s.input}
                        type="password"
                        value={tokenValue}
                        onChange={(event) => setTokenValue(event.target.value)}
                        placeholder="Paste provider token"
                      />
                    </div>
                    <div style={s.actionsRow}>
                      <button style={s.primaryButton} disabled={workspaceSaving} onClick={handleAddToken}>
                        {workspaceSaving ? "Saving…" : "Save token"}
                      </button>
                    </div>
                    <div style={s.tokenTable}>
                      {tokensFile.tokens.length === 0 ? (
                        <div style={s.empty}>No project tokens stored yet.</div>
                      ) : (
                        tokensFile.tokens.map((token) => {
                          const usage = tokenUsage(token.id);
                          return (
                            <div key={token.id} style={s.tokenRow}>
                              <div>
                                <div style={s.itemTitle}>{token.title}</div>
                                <div style={s.panelText}>
                                  Used by {usage.length === 0 ? "no profiles yet" : usage.map((profile) => profile.title).join(", ")}
                                </div>
                              </div>
                              <div style={s.panelText}>{projectTokenProviderLabel(token.provider)}</div>
                              <div style={s.tokenMono}>{maskToken(token.token)}</div>
                              <button style={s.dangerButton} onClick={() => void handleDeleteToken(token)}>
                                Delete
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div style={s.panelCard}>
                    <div style={s.panelTitle}>Agent Profiles</div>
                    <div style={s.panelText}>
                      Pair a provider with a model and, for API-backed profiles, a matching project token.
                    </div>
                    <div style={s.fieldGrid}>
                      <div>
                        <span style={s.label}>Profile Title</span>
                        <input
                          style={s.input}
                          value={profileDraft.title}
                          onChange={(event) => setProfileDraft((current) => ({ ...current, title: event.target.value }))}
                          placeholder="Reasoning OpenAI"
                        />
                      </div>
                      <div>
                        <span style={s.label}>Provider</span>
                        <select
                          style={s.select}
                          value={profileDraft.runner}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              runner: event.target.value as AgentRunner,
                              default_mcp: event.target.value === "claude_code",
                              model:
                                MODEL_OPTIONS[event.target.value as AgentRunner][0] ??
                                current.model,
                            }))
                          }
                        >
                          <option value="claude_code">Claude Code</option>
                          <option value="openai">OpenAI</option>
                          <option value="minimax">Minimax</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <span style={s.label}>Model</span>
                      <input
                        style={s.input}
                        list={`models-${profileDraft.runner}`}
                        value={profileDraft.model}
                        onChange={(event) => setProfileDraft((current) => ({ ...current, model: event.target.value }))}
                        placeholder="Select or type a model"
                      />
                    </div>
                    {profileDraft.runner === "claude_code" ? (
                      <div style={s.fieldGrid}>
                        <div>
                          <span style={s.label}>Binary</span>
                          <input
                            style={s.input}
                            value={profileDraft.binary}
                            onChange={(event) => setProfileDraft((current) => ({ ...current, binary: event.target.value }))}
                            placeholder="claude"
                          />
                        </div>
                        <div>
                          <span style={s.label}>Extra Args</span>
                          <input
                            style={s.input}
                            value={profileDraft.args}
                            onChange={(event) => setProfileDraft((current) => ({ ...current, args: event.target.value }))}
                            placeholder="--permission-mode auto"
                          />
                        </div>
                      </div>
                    ) : (
                      <div style={s.fieldGrid}>
                        <div>
                          <span style={s.label}>Project Token</span>
                          <select
                            style={s.select}
                            value={profileDraft.token_id}
                            onChange={(event) => setProfileDraft((current) => ({ ...current, token_id: event.target.value }))}
                          >
                            <option value="">Select a {providerLabel(profileDraft.runner)} token</option>
                            {matchingTokens.map((token) => (
                              <option key={token.id} value={token.id}>
                                {token.title}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <span style={s.label}>Temperature</span>
                          <input
                            style={s.input}
                            value={profileDraft.temperature}
                            onChange={(event) => setProfileDraft((current) => ({ ...current, temperature: event.target.value }))}
                            placeholder="0.2"
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <span style={s.label}>API Base Override</span>
                          <input
                            style={s.input}
                            value={profileDraft.api_base}
                            onChange={(event) => setProfileDraft((current) => ({ ...current, api_base: event.target.value }))}
                            placeholder="Optional custom base URL"
                          />
                        </div>
                      </div>
                    )}
                    <div style={s.fieldGrid}>
                      <div>
                        <span style={s.label}>Working Directory</span>
                        <select
                          style={s.select}
                          value={profileDraft.default_working_dir}
                          onChange={(event) =>
                            setProfileDraft((current) => ({
                              ...current,
                              default_working_dir: event.target.value as "project_root" | "current",
                            }))
                          }
                        >
                          <option value="project_root">Project root</option>
                          <option value="current">Current shell directory</option>
                        </select>
                      </div>
                      <label style={{ ...s.checkRow, alignItems: "center", marginTop: 22 }}>
                        <input
                          type="checkbox"
                          checked={profileDraft.default_mcp}
                          onChange={(event) =>
                            setProfileDraft((current) => ({ ...current, default_mcp: event.target.checked }))
                          }
                        />
                        <span>Enable MCP by default for this profile</span>
                      </label>
                    </div>
                    {profileDraft.runner !== "claude_code" && matchingTokens.length === 0 && (
                      <div style={s.helper}>
                        No {providerLabel(profileDraft.runner)} tokens exist yet. Add one in Token Vault first.
                      </div>
                    )}
                    <div style={s.actionsRow}>
                      <button style={s.primaryButton} disabled={workspaceSaving} onClick={handleAddProfile}>
                        {workspaceSaving ? "Saving…" : "Add profile"}
                      </button>
                    </div>
                    <div style={s.itemList}>
                      {profiles.length === 0 ? (
                        <div style={s.empty}>No agent profiles configured.</div>
                      ) : (
                        profiles.map((profile) => {
                          const assignedToken =
                            profile.runner === "claude_code"
                              ? null
                              : tokensFile.tokens.find((token) => token.id === profile.token_id) ?? null;
                          return (
                            <div key={profile.id} style={s.itemCard}>
                              <div style={s.itemHeader}>
                                <div>
                                  <div style={s.itemTitle}>{profile.title}</div>
                                  <div style={s.itemMeta}>
                                    {providerLabel(profile.runner)} · {profile.model ?? "default model"}
                                  </div>
                                </div>
                                {agents.default_profile === profile.id ? (
                                  <span style={s.tag}>Default</span>
                                ) : null}
                              </div>
                              <div style={s.tagRow}>
                                <span style={s.tag}>{profile.default_working_dir}</span>
                                <span style={s.tag}>{profile.default_mcp ? "MCP on" : "MCP off"}</span>
                                {assignedToken ? <span style={s.tag}>{assignedToken.title}</span> : null}
                              </div>
                              {profile.runner === "claude_code" ? (
                                <div style={s.itemMeta}>
                                  Binary: {profile.binary}
                                  {profile.args.length > 0 ? ` · Args: ${profile.args.join(" ")}` : ""}
                                </div>
                              ) : (
                                <div style={s.itemMeta}>
                                  Token provider: {assignedToken ? projectTokenProviderLabel(assignedToken.provider) : "env fallback"}
                                  {profile.api_base ? ` · Base: ${profile.api_base}` : ""}
                                </div>
                              )}
                              <div style={s.actionsRow}>
                                {agents.default_profile !== profile.id ? (
                                  <button style={s.button} onClick={() => void handleSetDefaultProfile(profile.id)}>
                                    Make default
                                  </button>
                                ) : null}
                                <button style={s.dangerButton} onClick={() => void handleDeleteProfile(profile.id)}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div style={s.panelCard}>
                    <div style={s.panelTitle}>Prompt Packs</div>
                    <div style={s.panelText}>
                      Package repeatable task instructions that operators can mix into any launch request.
                    </div>
                    <div>
                      <span style={s.label}>Title</span>
                      <input
                        style={s.input}
                        value={promptPackDraft.title}
                        onChange={(event) => setPromptPackDraft((current) => ({ ...current, title: event.target.value }))}
                        placeholder="Repository Refactor Pack"
                      />
                    </div>
                    <div>
                      <span style={s.label}>Instructions</span>
                      <textarea
                        style={s.textarea}
                        value={promptPackDraft.instructions}
                        onChange={(event) => setPromptPackDraft((current) => ({ ...current, instructions: event.target.value }))}
                        placeholder="Define the standing instructions this pack should inject into prompts."
                      />
                    </div>
                    <div>
                      <span style={s.label}>File Refs</span>
                      <textarea
                        style={{ ...s.textarea, minHeight: 80 }}
                        value={promptPackDraft.file_refs}
                        onChange={(event) => setPromptPackDraft((current) => ({ ...current, file_refs: event.target.value }))}
                        placeholder="README.md&#10;docs/architecture.md"
                      />
                    </div>
                    <div>
                      <span style={s.label}>MCP Reminder</span>
                      <textarea
                        style={{ ...s.textarea, minHeight: 80 }}
                        value={promptPackDraft.mcp_reminder}
                        onChange={(event) => setPromptPackDraft((current) => ({ ...current, mcp_reminder: event.target.value }))}
                        placeholder="Optional reminder about required MCP calls or final write_status behavior."
                      />
                    </div>
                    <div style={s.actionsRow}>
                      <button style={s.primaryButton} disabled={workspaceSaving} onClick={handleAddPromptPack}>
                        {workspaceSaving ? "Saving…" : "Add prompt pack"}
                      </button>
                    </div>
                    <div style={s.itemList}>
                      {promptPacks.length === 0 ? (
                        <div style={s.empty}>No prompt packs configured.</div>
                      ) : (
                        promptPacks.map((pack) => (
                          <div key={pack.id} style={s.itemCard}>
                            <div style={s.itemHeader}>
                              <div>
                                <div style={s.itemTitle}>{pack.title}</div>
                                <div style={s.itemMeta}>
                                  {pack.file_refs.length > 0 ? `${pack.file_refs.length} file refs` : "Inline instructions only"}
                                </div>
                              </div>
                            </div>
                            <div style={s.itemMeta}>{pack.instructions}</div>
                            {pack.mcp_reminder ? <div style={s.itemMeta}>MCP: {pack.mcp_reminder}</div> : null}
                            <div style={s.actionsRow}>
                              <button style={s.dangerButton} onClick={() => void handleDeletePromptPack(pack.id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={s.section}>
            <div style={s.sectionHeader}>Skill Profiles</div>
            <div style={s.sectionBody}>
              <div style={s.stack}>
                <div style={s.workspaceGrid}>
                  <div style={s.panelCard}>
                    <div style={s.panelTitle}>Registry Search</div>
                    <div style={s.panelText}>
                      Search npm, promote packages into project skill profiles, and optionally run the install command from here.
                    </div>
                    <div>
                      <span style={s.label}>Search npm</span>
                      <input
                        style={s.input}
                        value={skillQuery}
                        onChange={(event) => setSkillQuery(event.target.value)}
                        placeholder="eslint plugin, codemod, openapi generator…"
                      />
                    </div>
                    {skillSearchMessage ? <div style={s.helper}>{skillSearchMessage}</div> : null}
                    <div style={s.searchGrid}>
                      {skillResults.map((result) => {
                        const pkg = result.package;
                        const exists = skillProfiles.some((skill) => skill.package_name === pkg.name);
                        return (
                          <div key={pkg.name} style={s.itemCard}>
                            <div style={s.itemHeader}>
                              <div>
                                <div style={s.itemTitle}>{pkg.name}</div>
                                <div style={s.itemMeta}>v{pkg.version}</div>
                              </div>
                            </div>
                            <div style={s.itemMeta}>{pkg.description ?? "No package description."}</div>
                            {pkg.keywords && pkg.keywords.length > 0 ? (
                              <div style={s.tagRow}>
                                {pkg.keywords.slice(0, 5).map((keyword) => (
                                  <span key={keyword} style={s.tag}>{keyword}</span>
                                ))}
                              </div>
                            ) : null}
                            <div style={s.actionsRow}>
                              <button
                                style={exists ? s.subtleButton : s.button}
                                disabled={exists}
                                onClick={() => void handleAddSkill(result)}
                              >
                                {exists ? "Already added" : "Add skill profile"}
                              </button>
                              <button
                                style={s.primaryButton}
                                disabled={installingPackage === pkg.name}
                                onClick={() => void handleInstallSkill(result)}
                              >
                                {installingPackage === pkg.name ? "Installing…" : "Run npm install"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={s.panelCard}>
                    <div style={s.panelTitle}>Installed Skill Profiles</div>
                    <div style={s.panelText}>
                      These profiles record which external skill packages belong to the project and how to install them again.
                    </div>
                    <div style={s.itemList}>
                      {skillProfiles.length === 0 ? (
                        <div style={s.empty}>No skill profiles saved yet.</div>
                      ) : (
                        skillProfiles.map((skill) => (
                          <div key={skill.id} style={s.itemCard}>
                            <div style={s.itemHeader}>
                              <div>
                                <div style={s.itemTitle}>{skill.title}</div>
                                <div style={s.itemMeta}>
                                  {skill.package_name}
                                  {skill.latest_version ? ` · v${skill.latest_version}` : ""}
                                </div>
                              </div>
                            </div>
                            {skill.description ? <div style={s.itemMeta}>{skill.description}</div> : null}
                            {skill.install_command ? <div style={s.tokenMono}>{skill.install_command}</div> : null}
                            <div style={s.actionsRow}>
                              <button style={s.dangerButton} onClick={() => void handleDeleteSkill(skill.id)}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {installResult ? (
                      <div style={{ ...s.callout, borderColor: installResult.error ? "rgba(185, 28, 28, 0.22)" : "rgba(15, 118, 110, 0.22)" }}>
                        <span style={s.calloutTitle}>npm command</span>
                        {installResult.command}
                        {installResult.error ? `\n\n${installResult.error}` : ""}
                        {installResult.stdout ? `\n\nstdout:\n${installResult.stdout}` : ""}
                        {installResult.stderr ? `\n\nstderr:\n${installResult.stderr}` : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={s.section}>
            <div style={s.sectionHeader}>Running Agents</div>
            <div style={s.sectionBody}>
              {agentData.active_runs.length === 0 ? (
                <p style={s.empty}>No active agent runs right now.</p>
              ) : (
                <div style={s.itemList}>
                  {agentData.active_runs.map((run) => (
                    <div key={run.id} style={s.runCard}>
                      <div style={s.runHeader}>
                        <div style={s.itemTitle}>{run.profile_title}</div>
                        <span style={s.badge}>{run.status}</span>
                      </div>
                      <div style={s.itemMeta}>
                        {run.feature_item_title ? `${run.feature_item_title} · ` : ""}
                        {run.prompt_excerpt}
                      </div>
                      <div style={s.actionsRow}>
                        <button style={s.button} onClick={() => setSelectedRunId(run.id)}>View terminal</button>
                        <button style={s.dangerButton} onClick={() => void handleStop(run.id)}>Stop</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div style={s.stack}>
          <section style={s.section}>
            <div style={s.sectionHeader}>Terminal</div>
            <div style={s.sectionBody}>
              {selectedRunId ? (
                terminalError ? (
                  <div style={s.error}>{terminalError}</div>
                ) : terminal ? (
                  <>
                    {selectedRunNeedsStatusWarning ? (
                      <div style={{ ...s.callout, marginBottom: 12, borderColor: "rgba(202, 138, 4, 0.28)", background: "rgba(202, 138, 4, 0.10)" }}>
                        <span style={s.calloutTitle}>Tracking Warning</span>
                        This run exited successfully, but it never wrote a Konductor status snapshot. Code may have changed while dashboard tracking stayed stale.
                      </div>
                    ) : null}
                    <div style={s.terminal}>
                      <div style={s.terminalMeta}>
                        Run: {terminal.run.id}
                        {"\n"}Profile: {terminal.run.profile_title}
                        {"\n"}Status: {terminal.run.status}
                        {terminal.run.last_error ? `\nLast error: ${terminal.run.last_error}` : ""}
                      </div>
                      {terminal.log || "(No terminal output yet. The host accepted the run, but the selected agent has not emitted stdout/stderr yet.)"}
                    </div>
                  </>
                ) : (
                  <p style={s.empty}>Loading terminal output…</p>
                )
              ) : (
                <p style={s.empty}>Choose a run to inspect its command and terminal stream.</p>
              )}

              {visibleRuns.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                  <span style={s.label}>Select Run</span>
                  <select
                    style={s.select}
                    value={selectedRunId ?? ""}
                    onChange={(event) => setSelectedRunId(event.target.value)}
                  >
                    {visibleRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {(run.feature_item_title ?? "Direct task")} · {run.status}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
          </section>

          <section style={s.section}>
            <div style={s.sectionHeader}>Past Agent Tasks</div>
            <div style={s.sectionBody}>
              {agentData.past_runs.length === 0 ? (
                <p style={s.empty}>No completed agent tasks yet.</p>
              ) : (
                <div style={s.itemList}>
                  {agentData.past_runs.map((run) => (
                    <div key={run.id} style={s.runCard}>
                      <div style={s.runHeader}>
                        <div style={s.itemTitle}>{run.feature_item_title ?? "Direct task"}</div>
                        <span style={s.badge}>{run.status}</span>
                      </div>
                      <div style={s.itemMeta}>
                        {run.prompt_excerpt}
                        <br />
                        Status writes: {run.status_write_count} · Updates: {run.update_count}
                        {run.status === "succeeded" && run.status_write_count === 0 ? (
                          <>
                            <br />
                            Warning: successful exit with no Konductor status write.
                          </>
                        ) : null}
                        {run.last_error ? (
                          <>
                            <br />
                            Last error: {run.last_error}
                          </>
                        ) : null}
                      </div>
                      <div style={s.actionsRow}>
                        <button style={s.button} onClick={() => setSelectedRunId(run.id)}>View terminal</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {Object.entries(MODEL_OPTIONS).map(([runner, options]) => (
        <datalist key={runner} id={`models-${runner}`}>
          {options.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>
      ))}
    </div>
  );
}
