import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  fetchAdapters,
  fetchFleet,
  fetchHostHealth,
  fetchProjectAgents,
  formatApiError,
  installSkillPackage,
  saveProjectAgentsWorkspace,
  searchSkillRegistry,
  sendToAgent,
  startProjectRun,
  stopAgent,
  type AdapterInfo,
  type AgentWorkspaceConfig,
  type FleetAgent,
  type HostHealth,
  type NpmSkillSearchResult,
  type SkillInstallResult,
} from "../lib/registry.js";
import type { KonductorConfig, RunSummary } from "../lib/types.js";
import { s } from "../styles/ui.js";
import { AgentsHeroStats } from "./agents/AgentsHeroStats.js";
import { AgentProfilesPanel } from "./agents/AgentProfilesPanel.js";
import { FleetPanel } from "./agents/FleetPanel.js";
import { LaunchAgentForm, type LaunchDraft } from "./agents/LaunchAgentForm.js";
import { PromptPacksPanel } from "./agents/PromptPacksPanel.js";
import { RunList } from "./agents/RunLists.js";
import { SkillProfilesPanel } from "./agents/SkillProfilesPanel.js";
import { TerminalPanel } from "./agents/TerminalPanel.js";
import {
  buildNextProfile,
  buildPromptPack,
  buildSkillProfile,
  defaultProfileDraft,
  defaultPromptPackDraft,
  normalizeAgents,
  splitRuns,
  type ProfileDraft,
  type PromptPackDraft,
} from "./agents/helpers.js";

/** How often the live fleet is re-read while the page is open. */
const FLEET_POLL_MS = 2000;

interface AgentsPanelProps {
  projectId: string;
  config: KonductorConfig | null;
  initialRuns: RunSummary[];
  refreshToken: number;
  onDataChange: () => Promise<void>;
}

function emptyLaunchDraft(): LaunchDraft {
  return { profileId: "", slug: "", prompt: "", packIds: [], worktree: false, headless: false };
}

/**
 * The agents surface: launch an agent, watch the fleet, and configure what is
 * launchable.
 *
 * This composes focused components rather than holding the UI itself — the sections
 * below were one 1,700-line component, which made the launch path impossible to read
 * separately from the configuration editors.
 */
export function AgentsPanel({
  projectId,
  config,
  initialRuns,
  refreshToken,
  onDataChange,
}: AgentsPanelProps) {
  const [agents, setAgents] = useState<AgentWorkspaceConfig>(() => normalizeAgents(config));
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns);
  const [fleet, setFleet] = useState<FleetAgent[]>([]);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);

  const [launch, setLaunch] = useState<LaunchDraft>(emptyLaunchDraft);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(() => defaultProfileDraft());
  const [packDraft, setPackDraft] = useState<PromptPackDraft>(defaultPromptPackDraft);

  const [skillQuery, setSkillQuery] = useState("");
  const [skillResults, setSkillResults] = useState<NpmSkillSearchResult[]>([]);
  const [skillSearchMessage, setSkillSearchMessage] = useState<string | null>(null);
  const [installingPackage, setInstallingPackage] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<SkillInstallResult | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [data, health, adapterList] = await Promise.all([
          fetchProjectAgents(projectId),
          fetchHostHealth().catch(() => null),
          fetchAdapters(projectId).catch(() => ({ adapters: [], issues: [] })),
        ]);
        if (cancelled) return;
        setAgents(normalizeAgents(data.config));
        setRuns([...data.active_runs, ...data.past_runs]);
        setHostHealth(health);
        setAdapters(adapterList.adapters);
      } catch (err) {
        if (!cancelled) setError(formatApiError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken]);

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
    if (query.length < 2) {
      setSkillResults([]);
      setSkillSearchMessage(null);
      return;
    }
    let cancelled = false;
    setSkillSearchMessage("Searching npm…");
    void (async () => {
      try {
        const response = await searchSkillRegistry(query);
        if (cancelled) return;
        setSkillResults(response.objects ?? []);
        setSkillSearchMessage(
          (response.objects ?? []).length === 0 ? "No packages matched." : null,
        );
      } catch (err) {
        if (!cancelled) setSkillSearchMessage(formatApiError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    setProfileDraft((current) =>
      current.adapter || adapters.length === 0
        ? current
        : { ...current, adapter: adapters[0]!.id },
    );
  }, [adapters]);

  // ---- mutations -----------------------------------------------------------

  /**
   * Persist the whole agents document.
   *
   * The host's workspace endpoint takes the document as a unit, so every edit sends
   * all of it; the local state is updated optimistically from what came back.
   */
  const persist = useCallback(
    async (next: AgentWorkspaceConfig, successMessage: string) => {
      setBusy(true);
      setError(null);
      setMessage(null);
      try {
        const data = await saveProjectAgentsWorkspace(projectId, { agents: next });
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
      const run = await startProjectRun(projectId, {
        prompt: launch.prompt,
        source: "dashboard",
        ...(launch.profileId ? { profile_id: launch.profileId } : {}),
        ...(launch.packIds.length > 0 ? { prompt_packs: launch.packIds } : {}),
        ...(launch.slug.trim() ? { slug: launch.slug.trim() } : {}),
        ...(launch.headless ? { mode: "headless" as const } : {}),
        ...(launch.worktree ? { worktree: true } : {}),
      });
      setSelectedRunId(run.id);
      setLaunch((current) => ({ ...emptyLaunchDraft(), profileId: current.profileId }));
      setMessage(`Agent "${run.slug}" started.`);
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
      setProfileDraft(defaultProfileDraft(profileDraft.adapter));
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

  const handleInstallSkill = useCallback(
    async (result: NpmSkillSearchResult) => {
      setInstallingPackage(result.package.name);
      setInstallResult(null);
      try {
        setInstallResult(
          await installSkillPackage(projectId, {
            package_name: result.package.name,
            version: result.package.version,
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

  // A live agent that is not in `runs` yet (just launched) still belongs in the
  // terminal's run picker.
  const selectableRuns = useMemo(() => {
    const byId = new Map(runs.map((run) => [run.id, run] as const));
    return [...activeRuns, ...pastRuns].filter((run) => byId.has(run.id));
  }, [runs, activeRuns, pastRuns]);

  return (
    <div style={s.page}>
      <AgentsHeroStats
        hostHealth={hostHealth}
        fleet={fleet}
        adapters={adapters}
        profiles={agents.profiles}
        promptPacks={agents.prompt_packs}
        skillProfiles={agents.skill_profiles}
      />

      {error ? <p style={s.error}>{error}</p> : null}
      {message ? <p style={s.helper}>{message}</p> : null}

      <div style={s.columns}>
        <div style={s.stack}>
          <LaunchAgentForm
            profiles={agents.profiles}
            promptPacks={agents.prompt_packs}
            adapters={adapters}
            hostHealth={hostHealth}
            draft={launch}
            onChange={setLaunch}
            onSubmit={() => void handleStart()}
            submitting={busy}
            message={null}
            error={null}
          />

          <FleetPanel
            agents={fleet}
            selectedSlug={
              selectedRunId
                ? (fleet.find((agent) => agent.run_id === selectedRunId)?.slug ?? null)
                : null
            }
            onSelect={(slug) => {
              const agent = fleet.find((item) => item.slug === slug);
              if (agent) setSelectedRunId(agent.run_id);
            }}
            onSend={handleSend}
            onStop={handleStopAgent}
            busy={busy}
          />

          <section style={s.section}>
            <div style={s.sectionHeader}>Agent Workspace</div>
            <div style={s.sectionBody}>
              <div style={s.workspaceGrid}>
                <AgentProfilesPanel
                  profiles={agents.profiles}
                  defaultProfile={agents.default_profile}
                  adapters={adapters}
                  draft={profileDraft}
                  onDraftChange={setProfileDraft}
                  onAdd={handleAddProfile}
                  onDelete={(id) =>
                    void persist(
                      {
                        ...agents,
                        profiles: agents.profiles.filter((profile) => profile.id !== id),
                      },
                      "Profile removed.",
                    )
                  }
                  onSetDefault={(id) =>
                    void persist({ ...agents, default_profile: id }, "Default profile updated.")
                  }
                  busy={busy}
                />
                <PromptPacksPanel
                  promptPacks={agents.prompt_packs}
                  draft={packDraft}
                  onDraftChange={setPackDraft}
                  onAdd={handleAddPack}
                  onDelete={(id) =>
                    void persist(
                      {
                        ...agents,
                        prompt_packs: agents.prompt_packs.filter((pack) => pack.id !== id),
                      },
                      "Prompt pack removed.",
                    )
                  }
                  busy={busy}
                />
              </div>
            </div>
          </section>

          <SkillProfilesPanel
            skillProfiles={agents.skill_profiles}
            query={skillQuery}
            onQueryChange={setSkillQuery}
            results={skillResults}
            searchMessage={skillSearchMessage}
            installingPackage={installingPackage}
            installResult={installResult}
            onAdd={(result) =>
              void persist(
                {
                  ...agents,
                  skill_profiles: [
                    ...agents.skill_profiles,
                    buildSkillProfile(result, agents.skill_profiles),
                  ],
                },
                `Added skill profile "${result.package.name}".`,
              )
            }
            onInstall={(result) => void handleInstallSkill(result)}
            onDelete={(id) =>
              void persist(
                {
                  ...agents,
                  skill_profiles: agents.skill_profiles.filter((skill) => skill.id !== id),
                },
                "Skill profile removed.",
              )
            }
            busy={busy}
          />
        </div>

        <div style={s.stack}>
          <TerminalPanel
            runs={selectableRuns}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />
          <RunList
            title="Past Agent Tasks"
            runs={pastRuns}
            emptyText="No finished runs yet."
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />
        </div>
      </div>
    </div>
  );
}
