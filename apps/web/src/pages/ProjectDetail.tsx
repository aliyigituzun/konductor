import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  createProjectFeatureCategory,
  createProjectFeature,
  createProjectTodo,
  fetchProject,
  formatApiError,
  saveProjectFeaturePhases,
  reorderProjectFeaturePhases,
  resetProjectTelemetry,
  startProjectRun,
  updateProjectFeature,
  updateProjectTodo,
  type ProjectData,
} from "../lib/registry.js";
import { AppContext } from "../AppContext.js";
import { StatusStrip } from "../components/StatusStrip.js";
import { StatusNav, type StatusNavItem } from "../components/StatusNav.js";
import { BlockersPanel } from "../components/BlockersPanel.js";
import { DecisionsPanel } from "../components/decisions/DecisionsPanel.js";
import { TokenUsagePanel } from "../components/TokenUsagePanel.js";
import { ActivityPanel } from "../components/ActivityPanel.js";
import { FeaturesPanel } from "../components/FeaturesPanel.js";
import { ProjectFilesPanel } from "../components/project-files/ProjectFilesPanel.js";
import { UpdatesFeed } from "../components/UpdatesFeed.js";
import { AgentsPanel } from "../components/AgentsPanel.js";
import { ProjectInfoModal } from "../components/ProjectInfoModal.js";
import { AssetManagerPanel } from "../components/AssetManagerPanel.js";
import { ReviewsPanel } from "../components/ReviewsPanel.js";
import { TodosPanel } from "../components/TodosPanel.js";
import { ConfigurationDialog } from "../components/ConfigurationDialog.js";
import "./ProjectDetail.css";

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setProjectName } = useContext(AppContext);

  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const activeTab = searchParams.get("tab") ?? "status";
  const configurationOpen = searchParams.has("config");
  const statusScroller = useRef<HTMLDivElement>(null);

  // Each tab is its own page; carrying the previous tab's scroll offset over reads
  // as a glitch.
  useEffect(() => {
    document.querySelector(".k-main")?.scrollTo({ top: 0 });
  }, [activeTab]);

  useEffect(() => {
    if (searchParams.get("info") === "1") setShowInfo(true);
  }, [searchParams]);

  async function loadProject(projectId: string) {
    const project = await fetchProject(projectId);
    setData(project);
    setProjectName(project.entry.name);
  }

  useEffect(() => {
    if (!id) return;
    loadProject(id)
      .catch((e: unknown) => setError(formatApiError(e)))
      .finally(() => setLoading(false));
    return () => setProjectName(null);
  }, [id]);

  async function refreshProject() {
    if (!id) return;
    await loadProject(id);
    setRefreshToken((current) => current + 1);
  }

  const navItems = useMemo<StatusNavItem[]>(() => {
    const snap = data?.status ?? null;
    const updates = data?.updates ?? [];
    const telemetry = data?.telemetry ?? null;
    const openDecisions = (data?.decisions ?? []).filter((decision) => decision.status === "open").length;
    if (!snap) return [];
    const items: StatusNavItem[] = [
      { id: "sec-updates", label: "Updates", count: updates.length },
    ];
    if (snap.issues.blockers.length > 0) items.push({ id: "sec-blockers", label: "Blockers", count: snap.issues.blockers.length, tone: "danger" });
    items.push({ id: "sec-decisions", label: "Decisions", count: openDecisions, ...(openDecisions > 0 ? { tone: "warning" as const } : {}) });
    if (snap.issues.external_dependencies.length > 0) items.push({ id: "sec-dependencies", label: "Dependencies", count: snap.issues.external_dependencies.length });
    items.push({ id: "sec-tokens", label: "Model usage" });
    if (telemetry && (telemetry.top_tools.length > 0 || telemetry.top_files.length > 0)) items.push({ id: "sec-activity", label: "Activity" });
    return items;
  }, [data]);

  if (loading) return <p className="k-loading">Loading…</p>;
  if (error) return <p className="k-error" style={{ padding: 16 }}>{error}</p>;
  if (!data) return <p className="k-error" style={{ padding: 16 }}>Project not found.</p>;

  const { entry, status: snap, telemetry, updates = [] } = data;
  const activeRuns = data.runs.filter((run) => run.status === "running" || run.status === "queued").length;

  let content: React.ReactNode;
  if (activeTab === "docs") {
    content = <ProjectFilesPanel projectId={entry.id} />;
  } else if (activeTab === "features") {
    content = (
      <FeaturesPanel
        projectId={entry.id}
        snap={snap}
        config={data.config}
        decisions={data.decisions}
        onDecisionsChanged={refreshProject}
        onCreateFeature={async (payload) => {
          const created = await createProjectFeature(entry.id, payload);
          await refreshProject();
          return created;
        }}
        onCreateCategory={async (title) => {
          const created = await createProjectFeatureCategory(entry.id, title);
          await refreshProject();
          return created;
        }}
        onUpdateFeature={async (featureId, payload) => {
          await updateProjectFeature(entry.id, featureId, payload);
          await refreshProject();
        }}
        onSavePhases={async (phases) => {
          await saveProjectFeaturePhases(entry.id, phases);
          await refreshProject();
        }}
        onReorderPhases={async (phaseIds) => {
          await reorderProjectFeaturePhases(entry.id, phaseIds);
          await refreshProject();
        }}
        onStartRun={async (payload) => {
          const run = await startProjectRun(entry.id, { ...payload, source: "dashboard" });
          await refreshProject();
          return run;
        }}
      />
    );
  } else if (activeTab === "todos") {
    content = (
      <TodosPanel
        projectId={entry.id}
        snap={snap}
        config={data.config}
        onCreate={async (payload) => {
          const created = await createProjectTodo(entry.id, payload);
          await refreshProject();
          return created;
        }}
        onUpdate={async (todoId, payload) => {
          await updateProjectTodo(entry.id, todoId, payload);
          await refreshProject();
        }}
        onStartRun={async (payload) => {
          const run = await startProjectRun(entry.id, { ...payload, source: "dashboard" });
          await refreshProject();
          return run;
        }}
      />
    );
  } else if (activeTab === "agents") {
    content = (
      <AgentsPanel
        projectId={entry.id}
        config={data.config}
        status={snap}
        initialRuns={data.runs}
        refreshToken={refreshToken}
        onDataChange={refreshProject}
        renderConfiguration={false}
      />
    );
  } else if (activeTab === "assets") {
    content = <div className="k-page"><AssetManagerPanel projectId={entry.id} profiles={data.config?.agents?.profiles ?? []} /></div>;
  } else if (activeTab === "reviews") {
    content = <div className="k-page"><ReviewsPanel projectId={entry.id} refreshToken={refreshToken} /></div>;
  } else if (!snap) {
    content = (
      <div className="st">
        <aside className="st__side" />
        <div className="st__main">
          <p className="k-empty">No status yet · <code>konductor mcp serve</code></p>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="st">
        <aside className="st__side">
          <StatusNav items={navItems} scroller={statusScroller} />
        </aside>
        <div className="st__main" ref={statusScroller}>
          <div id="sec-updates" className="st__anchor"><UpdatesFeed updates={updates} /></div>
          <BlockersPanel
            blockers={snap.issues.blockers}
            dependencies={snap.issues.external_dependencies}
          />
          <DecisionsPanel
            projectId={entry.id}
            decisions={data.decisions}
            snap={snap}
            config={data.config}
            onChanged={refreshProject}
          />
          <div id="sec-tokens" className="st__anchor">
            <TokenUsagePanel
              telemetry={telemetry}
              onReset={async () => {
                await resetProjectTelemetry(entry.id);
                await refreshProject();
              }}
            />
          </div>
          <div id="sec-activity" className="st__anchor"><ActivityPanel telemetry={telemetry} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="k-page--fill">
      <AgentsPanel
        projectId={entry.id}
        config={data.config}
        status={snap}
        initialRuns={data.runs}
        refreshToken={refreshToken}
        onDataChange={refreshProject}
        configurationOnly
      />
      {snap && (
        <StatusStrip
          snap={snap}
          activeRuns={activeRuns}
          onShowInfo={() => setShowInfo(true)}
        />
      )}

      {content}

      {showInfo && (
        <ProjectInfoModal
          paths={data.important_paths}
          onClose={() => {
            setShowInfo(false);
            if (searchParams.get("info") === "1") {
              const next = new URLSearchParams(searchParams);
              next.delete("info");
              setSearchParams(next);
            }
          }}
        />
      )}
      <ConfigurationDialog
        open={configurationOpen}
        scope={{ type: "project", id: entry.id, label: entry.name, projectIds: [entry.id] }}
        onClose={() => {
          const next = new URLSearchParams(searchParams);
          next.delete("config");
          setSearchParams(next);
        }}
      />
    </div>
  );
}
