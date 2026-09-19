import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppContext } from "../AppContext.js";
import { ProjectInfoModal } from "../components/ProjectInfoModal.js";
import { StatusStrip } from "../components/StatusStrip.js";
import { AgentsPanel } from "../components/AgentsPanel.js";
import { AgentStatusIndicator } from "../components/agents/AgentStatusIndicator.js";
import { PromptPackField } from "../components/agents/PromptPackField.js";
import { FeatureDecisions, decisionsForFeature } from "../components/decisions/FeatureDecisions.js";
import {
  createProjectFeature,
  fetchHostHealth,
  fetchProject,
  formatApiError,
  startProjectRun,
  updateProjectFeaturePhases,
  type HostHealth,
  type ProjectData,
} from "../lib/registry.js";
import { itemStatusColor, itemStatusGlyph } from "../styles/ui.js";
import type { KonductorConfig } from "../lib/types.js";
import "../components/Features.css";

type ViewMode = "list" | "tree";

function firstPromptPackIds(config: KonductorConfig | null): string[] {
  return (config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id);
}

export function FeatureCategoryPage() {
  const { id, categoryId } = useParams<{ id: string; categoryId: string }>();
  const { setProjectName } = useContext(AppContext);

  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("default-profile");
  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [featureTitle, setFeatureTitle] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [newFeaturePhaseId, setNewFeaturePhaseId] = useState("");
  const [createTodo, setCreateTodo] = useState(true);
  const [featurePhaseId, setFeaturePhaseId] = useState("");
  const [savingPhases, setSavingPhases] = useState(false);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);

  async function loadProject(projectId: string) {
    const project = await fetchProject(projectId);
    setData(project);
    setProjectName(project.entry.name);
  }

  useEffect(() => {
    if (!id) return;
    loadProject(id)
      .catch((event: unknown) => setError(formatApiError(event)))
      .finally(() => setLoading(false));
    return () => setProjectName(null);
  }, [id, setProjectName]);

  useEffect(() => {
    fetchHostHealth()
      .then(setHostHealth)
      .catch((event: unknown) => setLaunchError(formatApiError(event)));
  }, []);

  useEffect(() => {
    if (!data?.config) return;
    setSelectedProfileId(data.config.agents?.default_profile ?? "default-profile");
    setSelectedPacks(firstPromptPackIds(data.config));
  }, [data?.config]);

  const category = useMemo(() => {
    if (!data?.status?.features || !categoryId) return null;
    return data.status.features.find((featureCategory) => featureCategory.id === categoryId) ?? null;
  }, [categoryId, data?.status?.features]);

  const items = category?.items ?? [];
  const selectedItem = useMemo(() => {
    if (!selectedItemId) return items[0] ?? null;
    return items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  }, [items, selectedItemId]);

  useEffect(() => {
    if (selectedItem?.id && selectedItem.id !== selectedItemId) setSelectedItemId(selectedItem.id);
  }, [selectedItem, selectedItemId]);

  useEffect(() => {
    setFeaturePhaseId(selectedItem?.phase_ids?.[0] ?? "");
    setPhaseMessage(null);
  }, [selectedItem?.id, selectedItem?.phase_ids]);

  async function refreshProject() {
    if (!id) return;
    await loadProject(id);
  }

  async function handleCreateFeature() {
    if (!id || !categoryId) return;
    if (!featureTitle.trim()) { setCreateError("Title required."); return; }
    setCreatingFeature(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const payload: { title: string; description?: string; category_id: string; phase_ids?: string[]; create_todo: boolean } = {
        title: featureTitle.trim(),
        category_id: categoryId,
        phase_ids: newFeaturePhaseId ? [newFeaturePhaseId] : [],
        create_todo: createTodo,
      };
      const description = featureDescription.trim();
      if (description) payload.description = description;
      const created = await createProjectFeature(id, payload);
      await refreshProject();
      setSelectedItemId(created.feature_item_id);
      setCreateMessage(`Added "${featureTitle.trim()}"`);
      setPrompt((current) => current || `Implement feature: ${featureTitle.trim()}`);
      setFeatureTitle("");
      setFeatureDescription("");
      setNewFeaturePhaseId("");
      setCreateTodo(true);
    } catch (event) {
      setCreateError(formatApiError(event));
    } finally {
      setCreatingFeature(false);
    }
  }

  async function handleSavePhases() {
    if (!id || !selectedItem) return;
    setSavingPhases(true);
    setLaunchError(null);
    setPhaseMessage(null);
    try {
      await updateProjectFeaturePhases(id, selectedItem.id, featurePhaseId ? [featurePhaseId] : []);
      await refreshProject();
      setPhaseMessage("Phases updated");
    } catch (event) {
      setLaunchError(formatApiError(event));
    } finally {
      setSavingPhases(false);
    }
  }

  async function handleStartRun() {
    if (!id || !selectedItem || !prompt.trim()) {
      setLaunchError("Select a feature and enter a prompt.");
      return;
    }
    setSubmitting(true);
    setLaunchError(null);
    setLaunchMessage(null);
    try {
      const run = await startProjectRun(id, {
        feature_item_id: selectedItem.id,
        profile_id: selectedProfileId,
        prompt_packs: selectedPacks,
        prompt,
        source: "dashboard",
      });
      await refreshProject();
      setPrompt("");
      setLaunchMessage(`Started ${run.slug}`);
    } catch (event) {
      setLaunchError(formatApiError(event));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="k-loading">Loading…</p>;
  if (error) return <p className="k-error" style={{ padding: 16 }}>{error}</p>;
  if (!data) return <p className="k-error" style={{ padding: 16 }}>Project not found.</p>;
  if (!category) {
    return (
      <div className="k-page">
        <p className="k-error">Category not found.</p>
        <Link className="k-link" to={`/project/${id}?tab=features`}>Back to features</Link>
      </div>
    );
  }

  const doneCount = items.filter((item) => item.status === "done").length;
  const phases = data.status?.feature_phases ?? [];
  const activeRuns = data.runs.filter((run) => run.status === "running" || run.status === "queued").length;

  return (
    <div className="k-page--fill">
      <AgentsPanel
        projectId={data.entry.id}
        config={data.config}
        status={data.status}
        initialRuns={data.runs}
        refreshToken={0}
        onDataChange={async () => loadProject(data.entry.id)}
        configurationOnly
      />
      {data.status && (
        <StatusStrip
          snap={data.status}
          activeRuns={activeRuns}
          onShowInfo={() => setShowInfo(true)}
        />
      )}

      <div className="k-toolbar">
        <Link className="k-btn k-btn--ghost k-btn--sm" to={`/project/${id}?tab=features`}>‹ Features</Link>
        <span className="k-toolbar__title">{category.title}</span>
        <span className="k-faint k-num">{doneCount}/{items.length}</span>
        <AgentStatusIndicator activeAgents={hostHealth?.running_runs.length ?? 0} hostHealth={hostHealth} hasError={Boolean(launchError || createError)} />
        <span className="k-spacer" />
        <div className="k-seg">
          <button type="button" className={`k-seg__btn${viewMode === "list" ? " k-seg__btn--active" : ""}`} onClick={() => setViewMode("list")}>List</button>
          <button type="button" className={`k-seg__btn${viewMode === "tree" ? " k-seg__btn--active" : ""}`} onClick={() => setViewMode("tree")}>Tree</button>
        </div>
      </div>

      <div className="fc">
        <div className="fc__list">
          {items.length === 0 ? (
            <p className="k-empty" style={{ padding: 10 }}>No features</p>
          ) : viewMode === "list" ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`fc__feature${selectedItem?.id === item.id ? " fc__feature--active" : ""}`}
                onClick={() => setSelectedItemId(item.id)}
              >
                <span className="fc__feature-title">
                  <span className="k-glyph" style={{ color: itemStatusColor(item.status) }}>{itemStatusGlyph(item.status)}</span>
                  <span className="k-truncate">{item.title}</span>
                </span>
                {item.description ? <span className="fc__feature-desc">{item.description}</span> : null}
                {(() => {
                  const linked = decisionsForFeature(data.decisions, item.id);
                  if (linked.length === 0) return null;
                  const open = linked.some((decision) => decision.status === "open");
                  return <span className={`dc__count${open ? " dc__count--open" : ""}`}>◆ {linked.length} decision{linked.length === 1 ? "" : "s"}</span>;
                })()}
              </button>
            ))
          ) : (
            <div className="fc__tree">
              <div className="fc__tree-root">{category.title}</div>
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`fc__tree-line${selectedItem?.id === item.id ? " fc__tree-line--active" : ""}`}
                  onClick={() => setSelectedItemId(item.id)}
                >
                  <span className="fc__tree-branch">{index === items.length - 1 ? "└─" : "├─"}</span>
                  <span style={{ color: itemStatusColor(item.status) }}>{itemStatusGlyph(item.status)}</span>
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="fc__main">
          {selectedItem ? (
            <section className="k-section">
              <div className="k-section__header">
                <span className="k-glyph" style={{ color: itemStatusColor(selectedItem.status) }}>{itemStatusGlyph(selectedItem.status)}</span>
                <span className="k-truncate" style={{ color: "var(--text-primary)" }}>{selectedItem.title}</span>
                <span className="k-section__count">{selectedItem.status.replace("_", " ")}</span>
              </div>
              <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
                {selectedItem.description ? <p className="k-note">{selectedItem.description}</p> : null}
                <FeatureDecisions
                  projectId={data.entry.id}
                  featureItemId={selectedItem.id}
                  decisions={data.decisions}
                  snap={data.status}
                  config={data.config}
                  onChanged={() => loadProject(data.entry.id)}
                />
                <div className="k-field">
                  <label className="k-label" htmlFor="fc-feature-phase">Feature phase</label>
                  <select id="fc-feature-phase" className="k-select" value={featurePhaseId} disabled={phases.length === 0} onChange={(event) => setFeaturePhaseId(event.target.value)}>
                    <option value="">{phases.length === 0 ? "No feature phases" : "No phase"}</option>
                    {phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.title}</option>)}
                  </select>
                  {phases.length > 0 ? (
                    <div className="k-actions">
                      <button type="button" className="k-btn k-btn--sm" disabled={savingPhases} onClick={handleSavePhases}>
                        {savingPhases ? "Saving…" : "Save phases"}
                      </button>
                      {phaseMessage ? <span className="k-note">{phaseMessage}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="k-field-grid">
                  <div className="k-field">
                    <label className="k-label" htmlFor="fc-profile">Profile</label>
                    <select id="fc-profile" className="k-select" value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
                      {(data.config?.agents?.profiles ?? []).map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.title}</option>
                      ))}
                    </select>
                  </div>
                  <PromptPackField packs={data.config?.agents?.prompt_packs ?? []} selected={selectedPacks} onChange={setSelectedPacks} />
                </div>
                <div className="k-field">
                  <label className="k-label" htmlFor="fc-prompt">Task</label>
                  <textarea id="fc-prompt" className="k-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent do with this feature?" />
                </div>
                {launchError ? <p className="k-error">{launchError}</p> : null}
                <div className="k-actions">
                  <button type="button" className="k-btn k-btn--primary" disabled={submitting} onClick={handleStartRun}>
                    {submitting ? "Starting…" : "Start agent"}
                  </button>
                  {launchMessage ? <span className="k-note">{launchMessage}</span> : null}
                </div>
              </div>
            </section>
          ) : null}

          <section className="k-section">
            <div className="k-section__header">New feature in {category.title}</div>
            <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
              <div className="k-field">
                <label className="k-label" htmlFor="fc-title">Title</label>
                <input id="fc-title" className="k-input" value={featureTitle} onChange={(event) => setFeatureTitle(event.target.value)} />
              </div>
              <label className="ft__todo-toggle"><input type="checkbox" checked={createTodo} onChange={(event) => setCreateTodo(event.target.checked)} /> Create a linked to-do</label>
              <div className="k-field">
                <label className="k-label" htmlFor="fc-desc">Description</label>
                <textarea id="fc-desc" className="k-textarea" style={{ minHeight: 64 }} value={featureDescription} onChange={(event) => setFeatureDescription(event.target.value)} placeholder="Optional scope or acceptance criteria" />
              </div>
              <div className="k-field">
                <label className="k-label" htmlFor="fc-new-feature-phase">Phase</label>
                <select id="fc-new-feature-phase" className="k-select" value={newFeaturePhaseId} disabled={phases.length === 0} onChange={(event) => setNewFeaturePhaseId(event.target.value)}>
                  <option value="">{phases.length === 0 ? "No feature phases" : "No phase"}</option>
                  {phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.title}</option>)}
                </select>
              </div>
              {createError ? <p className="k-error">{createError}</p> : null}
              <div className="k-actions">
                <button type="button" className="k-btn" disabled={creatingFeature} onClick={handleCreateFeature}>
                  {creatingFeature ? "Adding…" : "Add feature"}
                </button>
                {createMessage ? <span className="k-note">{createMessage}</span> : null}
              </div>
            </div>
          </section>
        </div>
      </div>

      {showInfo && <ProjectInfoModal paths={data.important_paths} onClose={() => setShowInfo(false)} />}
    </div>
  );
}
