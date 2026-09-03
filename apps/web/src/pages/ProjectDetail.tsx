import React, { useContext, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  createProjectFeature,
  fetchProject,
  formatApiError,
  startProjectRun,
  type ProjectData,
} from "../lib/registry.js";
import { AppContext } from "../AppContext.js";
import { StatusStrip } from "../components/StatusStrip.js";
import { PhaseBoard } from "../components/PhaseBoard.js";
import { BlockersPanel } from "../components/BlockersPanel.js";
import { TokenUsagePanel } from "../components/TokenUsagePanel.js";
import { ActivityPanel } from "../components/ActivityPanel.js";
import { FeaturesPanel } from "../components/FeaturesPanel.js";
import { ProjectDocsPanel } from "../components/ProjectDocsPanel.js";
import { UpdatesFeed } from "../components/UpdatesFeed.js";
import { AgentsPanel } from "../components/AgentsPanel.js";
import { ProjectInfoModal } from "../components/ProjectInfoModal.js";

const s: Record<string, React.CSSProperties> = {
  page: { padding: "24px 32px", maxWidth: 1100, margin: "0 auto" },
  loading: { color: "var(--text-tertiary)", fontSize: 13, padding: "24px 0" },
  error: { color: "var(--danger)", fontSize: 13, padding: "24px 0" },
  summary: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    marginBottom: 24,
    boxShadow: "var(--shadow-soft)",
  },
  summaryText: {
    fontSize: 14,
    color: "var(--text-primary)",
    lineHeight: 1.6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: 8,
  },
};

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

  useEffect(() => {
    if (searchParams.get("info") === "1") {
      setShowInfo(true);
    }
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

  if (loading) return <div style={{ padding: 32 }}><p style={s.loading}>Loading…</p></div>;
  if (error) return <div style={{ padding: 32 }}><p style={s.error}>{error}</p></div>;
  if (!data) return <div style={{ padding: 32 }}><p style={s.error}>Project not found.</p></div>;

  const { entry, status: snap, telemetry, updates = [] } = data;
  const activeRuns = data.runs.filter((run) => run.status === "running" || run.status === "queued").length;

  let content: React.ReactNode;
  if (activeTab === "docs") {
    content = <ProjectDocsPanel projectId={entry.id} />;
  } else if (activeTab === "features") {
    content = (
      <FeaturesPanel
        projectId={entry.id}
        snap={snap}
        config={data.config}
        onCreateFeature={async (payload) => {
          const created = await createProjectFeature(entry.id, payload);
          await refreshProject();
          return created;
        }}
        onStartRun={async (payload) => {
          const run = await startProjectRun(entry.id, {
            ...payload,
            source: "dashboard",
          });
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
        initialRuns={data.runs}
        refreshToken={refreshToken}
        onDataChange={refreshProject}
      />
    );
  } else if (!snap) {
    content = (
      <>
        <h2>{entry.name}</h2>
        <p style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
          No status file found. Run <code>konductor mcp serve</code> to let Claude write a status update.
        </p>
      </>
    );
  } else {
    content = (
      <>
        <div style={{ marginBottom: 24 }}>
          <div style={s.sectionTitle}>Status Summary</div>
          <div style={s.summary}>
            <p style={s.summaryText}>{snap.status.summary}</p>
          </div>
        </div>

        <UpdatesFeed updates={updates} />

        <PhaseBoard phases={snap.phases} />

        <BlockersPanel
          blockers={snap.issues.blockers}
          decisions={snap.issues.decisions_needed}
          dependencies={snap.issues.external_dependencies}
        />

        <TokenUsagePanel telemetry={telemetry} />
        <ActivityPanel telemetry={telemetry} />
      </>
    );
  }

  return (
    <div style={{ ...s.page, maxWidth: activeTab === "docs" ? 1200 : 1100 }}>
      {snap && (
        <StatusStrip
          snap={snap}
          lastSync={entry.last_sync}
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
    </div>
  );
}
