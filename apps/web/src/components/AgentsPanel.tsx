import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  fetchAdapters,
  fetchFleet,
  fetchHostHealth,
  fetchProjectAgents,
  formatApiError,
  installSkillPackage,
  saveProjectAgentsWorkspace,
  respondToAgentDialog,
  sendToAgent,
  setupHarness,
  startProjectRun,
  stopAgent,
  type AdapterInfo,
  type AgentWorkspaceConfig,
  type FleetAgent,
  type HostHealth,
  type SkillLink,
  type SkillInstallResult,
} from "../lib/registry.js";
import type { KonductorConfig, RunSummary, StatusSnapshot } from "../lib/types.js";
import {
  AgentConfigurationDialog,
  type ConfigurationSection,
} from "./agents/AgentConfigurationDialog.js";
import { FleetPanel } from "./agents/FleetPanel.js";
import { LaunchAgentForm, type LaunchDraft } from "./agents/LaunchAgentForm.js";
import { AgentStatusIndicator } from "./agents/AgentStatusIndicator.js";
import { RunList } from "./agents/RunLists.js";
import { TerminalDialog } from "./agents/TerminalDialog.js";
import { defaultProviderConnectionDraft, type ProviderConnectionDraft } from "./agents/ProviderConnectionsPanel.js";
import {
  buildNextProfile,
  buildPromptPack,
  buildSkillProfile,
  defaultProfileDraft,
  defaultPromptPackDraft,
  normalizeAgents,
  parseSkillLink,
  splitRuns,
  type ProfileDraft,
  type PromptPackDraft,
} from "./agents/helpers.js";

/** How often the live fleet is re-read while the page is open. */
const FLEET_POLL_MS = 2000;

interface AgentsPanelProps {
  projectId: string;
  config: KonductorConfig | null;
  status: StatusSnapshot | null;
  initialRuns: RunSummary[];
  refreshToken: number;
  onDataChange: () => Promise<void>;
  /** Render only the project-wide configuration dialog when used by the project shell. */
  configurationOnly?: boolean;
  /** The project shell owns the dialog when false. */
  renderConfiguration?: boolean;
}

function emptyLaunchDraft(): LaunchDraft {
  return { profileId: "", slug: "", prompt: "", packIds: [], todoId: "", featureItemId: "" };
}

/**
 * The agents surface: launch an agent, watch the fleet, and configure what is
 * launchable.
 */
export function AgentsPanel({
  projectId,
  config,
  status,
  initialRuns,
  refreshToken,
  onDataChange,
  configurationOnly = false,
  renderConfiguration = true,
}: AgentsPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [agents, setAgents] = useState<AgentWorkspaceConfig>(() => normalizeAgents(config));
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns);
  const [fleet, setFleet] = useState<FleetAgent[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [adaptersLoading, setAdaptersLoading] = useState(true);
  const [adaptersError, setAdaptersError] = useState<string | null>(null);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);

  const [launch, setLaunch] = useState<LaunchDraft>(emptyLaunchDraft);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => defaultProfileDraft());
  const [packDraft, setPackDraft] = useState<PromptPackDraft>(defaultPromptPackDraft);
  const [providerDraft, setProviderDraft] = useState<ProviderConnectionDraft>(defaultProviderConnectionDraft);

  const [skillQuery, setSkillQuery] = useState("");
  const [skillLink, setSkillLink] = useState<SkillLink | null>(null);
  const [skillLinkMessage, setSkillLinkMessage] = useState<string | null>(null);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<SkillInstallResult | null>(null);
  const [settingUpAdapter, setSettingUpAdapter] = useState<string | null>(null);

  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [configurationSection, setConfigurationSection] = useState<ConfigurationSection>("profiles");
  /** Slug of the agent whose pane is open in the in-app terminal, if any. */
  const [terminalSlug, setTerminalSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { active_runs: activeRuns, past_runs: pastRuns } = useMemo(() => splitRuns(runs), [runs]);

  // ---- loading -------------------------------------------------------------

  const reloadWorkspace = useCallback(async () => {
    const data = await fetchProjectAgents(projectId);
    setAgents(normalizeAgents(data.config));
    setRuns([...data.active_runs, ...data.past_runs]);
  }, [projectId]);

  const reloadAdapters = useCallback(async () => {
    setAdaptersLoading(true);
    setAdaptersError(null);
    try {
      const adapterList = await fetchAdapters(projectId);
      setAdapters(adapterList.adapters);
    } catch (err) {
      setAdapters([]);
      setAdaptersError(formatApiError(err));
    } finally {
      setAdaptersLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void reloadAdapters();
    void (async () => {
      try {
        const [data, health] = await Promise.all([
          fetchProjectAgents(projectId),
          fetchHostHealth().catch(() => null),
        ]);
        if (cancelled) return;
        setAgents(normalizeAgents(data.config));
        setRuns([...data.active_runs, ...data.past_runs]);
        setHostHealth(health);
      } catch (err) {
        if (!cancelled) setError(formatApiError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken, reloadAdapters]);

  // The fleet is live state that changes without us acting, so it is polled rather
  // than refetched only on mutation.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { agents: live } = await fetchFleet();
        if (!cancelled) setFleet(live);
      } catch {
        if (!cancelled) setFleet([]);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), FLEET_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [projectId]);

  const deferredQuery = useDeferredValue(skillQuery);
  useEffect(() => {
    const query = deferredQuery.trim();
    if (!query) {
      setSkillLink(null);
      setSkillLinkMessage(null);
      return;
    }
    try {
      setSkillLink(parseSkillLink(query));
      setSkillLinkMessage(null);
    } catch (err) {
      setSkillLink(null);
      setSkillLinkMessage(err instanceof Error ? err.message : String(err));
    }
  }, [deferredQuery]);

  // Keep the launch form pointed at a profile that still exists.
  useEffect(() => {
    if (agents.profiles.length === 0) return;
    setLaunch((current) =>
      agents.profiles.some((profile) => profile.id === current.profileId)
        ? current
        : { ...current, profileId: agents.default_profile || agents.profiles[0]!.id },
    );
  }, [agents.profiles, agents.default_profile]);

  // Seed the profile draft with a real harness and its first provider once the
  // adapter catalog is known, so the pickers never start on an empty choice.
  useEffect(() => {
    setProfileDraft((current) => {
      if (adapters.length === 0) return current;
      const adapter = adapters.find((item) => item.id === current.adapter) ?? adapters[0]!;
      const provider = adapter.providers.some((item) => item.id === current.provider)
        ? current.provider
        : (adapter.providers[0]?.id ?? "");
      if (adapter.id === current.adapter && provider === current.provider) return current;
      return { ...current, adapter: adapter.id, provider };
    });
  }, [adapters]);

  useEffect(() => {
    const requested = searchParams.get("agentConfig");
    if (requested === "profiles" || requested === "providers" || requested === "prompts" || requested === "skills" || requested === "assets") {
      setConfigurationSection(requested);
      setConfigurationOpen(true);
    }
  }, [searchParams]);

  // ---- mutations -----------------------------------------------------------

  /**
   * Persist the whole agents document.
   *
   * The host's workspace endpoint takes the document as a unit, so every edit sends
   * all of it; the local state is updated optimistically from what came back.
   */
  const persist = useCallback(
    async (next: AgentWorkspaceConfig, successMessage: string, providerKeys?: Record<string, string>) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const data = await saveProjectAgentsWorkspace(projectId, { agents: next, ...(providerKeys ? { provider_keys: providerKeys } : {}) });
        setAgents(normalizeAgents(data.config));
        setRuns([...data.active_runs, ...data.past_runs]);
        setMessage(successMessage);
        await onDataChange();
      } catch (err) {
        setError(formatApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [projectId, onDataChange],
  );

  const handleStart = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Only send the keys that are actually set: the host treats an absent field
      // as "use the profile's setting", which is not the same as an explicit false.
      await startProjectRun(projectId, {
        prompt: launch.prompt,
        source: "dashboard",
        ...(launch.profileId ? { profile_id: launch.profileId } : {}),
        ...(launch.packIds.length > 0 ? { prompt_packs: launch.packIds } : {}),
        ...(launch.todoId ? { todo_id: launch.todoId } : {}),
        ...(launch.featureItemId ? { feature_item_id: launch.featureItemId } : {}),
        ...(launch.slug.trim() ? { slug: launch.slug.trim() } : {}),
      });
      setLaunch((current) => ({ ...emptyLaunchDraft(), profileId: current.profileId }));
      await reloadWorkspace();
      await onDataChange();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }, [projectId, launch, reloadWorkspace, onDataChange]);

  const handleSend = useCallback(async (slug: string, text: string) => {
    setError(null);
    try {
      await sendToAgent(slug, text);
      setMessage(`Sent to ${slug}.`);
    } catch (err) {
      setError(formatApiError(err));
    }
  }, []);

  const handleDialogResponse = useCallback(async (slug: string, action: "accept" | "cancel") => {
    setError(null);
    try {
      await respondToAgentDialog(slug, action);
      setMessage(action === "accept" ? `Confirmed the highlighted choice for ${slug}.` : `Cancelled the dialog for ${slug}.`);
    } catch (err) {
      setError(formatApiError(err));
    }
  }, []);

  const handleSetupAdapter = useCallback(async (adapterId: string) => {
    const adapter = adapters.find((item) => item.id === adapterId);
    let installMissingBinary = false;
    if (adapter?.setup.runtime_package && !adapter.installed) {
      installMissingBinary = window.confirm(
        `${adapter.title} is not installed. Install ${adapter.setup.runtime_package} into ` +
          `Konductor's isolated ${adapter.setup.directory}/runtime directory? ` +
          `This will not change your existing ${adapter.title} configuration.`,
      );
      if (!installMissingBinary) return;
    }
    setSettingUpAdapter(adapterId);
    setError(null);
    setMessage(null);
    try {
      const result = await setupHarness(projectId, adapterId, installMissingBinary);
      const adapterList = await fetchAdapters(projectId);
      setAdapters(adapterList.adapters);
      setMessage(
        `${adapterId} setup is ready${result.mcp_package ? ` with ${result.mcp_package}` : ""}.`,
      );
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSettingUpAdapter(null);
    }
  }, [projectId, adapters]);

  const handleStopAgent = useCallback(
    async (slug: string) => {
      setBusy(true);
      setError(null);
      try {
        await stopAgent(slug);
        setMessage(`Stopped ${slug}.`);
        await reloadWorkspace();
        await onDataChange();
      } catch (err) {
        setError(formatApiError(err));
      } finally {
        setBusy(false);
      }
    },
    [reloadWorkspace, onDataChange],
  );

  const handleAddProfile = useCallback(() => {
    try {
      const profile = buildNextProfile(profileDraft, agents.profiles);
      setProfileDraft(defaultProfileDraft(profileDraft.adapter, profileDraft.provider));
      void persist(
        { ...agents, profiles: [...agents.profiles, profile] },
        `Added profile "${profile.title}".`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [profileDraft, agents, persist]);

  const handleAddPack = useCallback(() => {
    try {
      const pack = buildPromptPack(packDraft, agents.prompt_packs);
      setPackDraft(defaultPromptPackDraft());
      void persist(
        { ...agents, prompt_packs: [...agents.prompt_packs, pack] },
        `Added prompt pack "${pack.title}".`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [packDraft, agents, persist]);

  const handleAddProvider = useCallback(() => {
    try {
      const endpoint = new URL(providerDraft.endpoint.trim());
      if (providerDraft.kind === "remote_api" && endpoint.protocol !== "https:") {
        throw new Error("Remote APIs must use HTTPS.");
      }
      if (providerDraft.kind === "local_endpoint" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.host)) {
        throw new Error("Existing local services must use localhost, 127.0.0.1, or [::1].");
      }
      const id = providerDraft.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
      let uniqueId = id;
      let number = 2;
      while (agents.provider_connections.some((connection) => connection.id === uniqueId)) uniqueId = `${id}-${number++}`;
      const provider = providerDraft.provider.trim();
      const invalidProvider = !/^[a-z0-9][a-z0-9_-]*$/.test(provider);
      if (invalidProvider) throw new Error("Harness provider ID must use lowercase letters, numbers, hyphens, or underscores.");
      if (providerDraft.authEnv.trim() && !/^[A-Z][A-Z0-9_]*$/.test(providerDraft.authEnv.trim())) {
        throw new Error("Environment-variable names use uppercase letters, numbers, and underscores. Enter the name that already holds this API key, such as OPENAI_API_KEY.");
      }
      const incompatible = providerDraft.compatibleAdapters.filter((adapterId) =>
        !adapters.find((adapter) => adapter.id === adapterId)?.providers.some((item) => item.id === provider),
      );
      if (incompatible.length > 0) throw new Error("Every compatible harness must declare this provider ID.");
      const authEnv = providerDraft.authEnv.trim() || (providerDraft.apiKey.trim() ? `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY` : "");
      const connection = { id: uniqueId, title: providerDraft.title.trim(), kind: providerDraft.kind, endpoint: endpoint.toString().replace(/\/$/, ""), provider, compatible_adapters: providerDraft.compatibleAdapters, models: [], ...(authEnv ? { auth_env: authEnv } : {}), enabled: true };
      setProviderDraft(defaultProviderConnectionDraft());
      void persist({ ...agents, provider_connections: [...agents.provider_connections, connection] }, `Added provider connection "${connection.title}".`, providerDraft.apiKey.trim() ? { [connection.id]: providerDraft.apiKey } : undefined);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [providerDraft, agents, adapters, persist]);

  const handleInstallSkill = useCallback(
    async (link: SkillLink) => {
      setInstallingPackage(link.url);
      setInstallResult(null);
      try {
        setInstallResult(
          await installSkillPackage(projectId, {
            source: link.source,
            url: link.url,
          }),
        );
      } catch (err) {
        setError(formatApiError(err));
      } finally {
        setInstallingPackage(null);
      }
    },
    [projectId],
  );

  const openConfiguration = useCallback((section: ConfigurationSection) => {
    setConfigurationSection(section);
    setConfigurationOpen(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("agentConfig", section);
      return next;
    });
  }, [setSearchParams]);

  const closeConfiguration = useCallback(() => {
    setConfigurationOpen(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("agentConfig");
      return next;
    });
  }, [setSearchParams]);

  const page = (
    <div className="k-page--fill">
      {error ? <div className="ag__msg ag__msg--error">{error}</div> : message ? <div className="ag__msg">{message}</div> : null}
      <div className="ag">
        <div className="ag__launch">
          <LaunchAgentForm
            status={<AgentStatusIndicator activeAgents={fleet.length} hostHealth={hostHealth} hasError={Boolean(error)} />}
            profiles={agents.profiles}
            promptPacks={agents.prompt_packs}
            todos={status?.todos ?? []}
            features={(status?.features ?? []).flatMap((category) => category.items.map((item) => ({ ...item, categoryTitle: category.title })))}
            adapters={adapters}
            draft={launch}
            onChange={setLaunch}
            onSubmit={() => void handleStart()}
            submitting={busy}
            settingUpAdapter={settingUpAdapter}
            onSetupAdapter={(adapterId) => void handleSetupAdapter(adapterId)}
            onOpenConfiguration={() => openConfiguration("profiles")}
          />
        </div>
        <div className="ag__right">
          <FleetPanel
            agents={fleet}
            onSend={handleSend}
            onRespond={handleDialogResponse}
            onStop={handleStopAgent}
            onOpenTerminal={setTerminalSlug}
            busy={busy}
            projectId={projectId}
          />
          <div className="ag__runs">
            <RunList title="Running" runs={activeRuns} />
            <RunList title="History" runs={pastRuns} collapsible />
          </div>
        </div>
      </div>
    </div>
  );

  const configuration = <AgentConfigurationDialog
    open={configurationOpen}
    projectId={projectId}
    section={configurationSection}
    onSectionChange={openConfiguration}
    onClose={closeConfiguration}
    profiles={agents.profiles}
    defaultProfile={agents.default_profile}
    adapters={adapters}
    adaptersLoading={adaptersLoading}
    adaptersError={adaptersError}
    onRetryAdapters={() => void reloadAdapters()}
    profileDraft={profileDraft}
    onProfileDraftChange={setProfileDraft}
    onAddProfile={handleAddProfile}
    onDeleteProfile={(id) => {
      const profiles = agents.profiles.filter((profile) => profile.id !== id);
      void persist({ ...agents, profiles, default_profile: agents.default_profile === id ? (profiles[0]?.id ?? agents.default_profile) : agents.default_profile }, "Profile removed.");
    }}
    onSetDefaultProfile={(id) => void persist({ ...agents, default_profile: id }, "Default profile updated.")}
    providerConnections={agents.provider_connections}
    providerDraft={providerDraft}
    onProviderDraftChange={setProviderDraft}
    onAddProvider={handleAddProvider}
    onToggleProvider={(id) => void persist({ ...agents, provider_connections: agents.provider_connections.map((connection) => connection.id === id ? { ...connection, enabled: !connection.enabled } : connection) }, "Provider connection updated.")}
    onDeleteProvider={(id) => void persist({ ...agents, provider_connections: agents.provider_connections.filter((connection) => connection.id !== id) }, "Provider connection removed.")}
    promptPacks={agents.prompt_packs}
    packDraft={packDraft}
    onPackDraftChange={setPackDraft}
    onAddPack={handleAddPack}
    onDeletePack={(id) => void persist({ ...agents, prompt_packs: agents.prompt_packs.filter((pack) => pack.id !== id) }, "Prompt pack removed.")}
    skillProfiles={agents.skill_profiles}
    skillQuery={skillQuery}
    onSkillQueryChange={setSkillQuery}
    skillLink={skillLink}
    skillLinkMessage={skillLinkMessage}
    installingPackage={installingPackage}
    installResult={installResult}
    onAddSkill={(link) => void persist({ ...agents, skill_profiles: [...agents.skill_profiles, buildSkillProfile(link, agents.skill_profiles)] }, `Added skill profile "${link.name}".`)}
    onInstallSkill={(link) => void handleInstallSkill(link)}
    onDeleteSkill={(id) => void persist({ ...agents, skill_profiles: agents.skill_profiles.filter((skill) => skill.id !== id) }, "Skill profile removed.")}
    busy={busy}
    error={error}
    message={message}
  />;

  const terminal = terminalSlug ? (
    <TerminalDialog
      slug={terminalSlug}
      agent={fleet.find((agent) => agent.slug === terminalSlug) ?? null}
      onSend={handleSend}
      onStop={async (slug) => {
        await handleStopAgent(slug);
        setTerminalSlug(null);
      }}
      onClose={() => setTerminalSlug(null)}
      busy={busy}
    />
  ) : null;

  if (configurationOnly) return configuration;

  return <>{page}{terminal}{renderConfiguration ? configuration : null}</>;
}
