import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRegistry, fetchProject, deleteProject, type ProjectData } from "../lib/registry.js";
import type { Registry } from "../lib/types.js";
import { AppContext } from "../AppContext.js";
import { itemStatusColor, relativeTime } from "../styles/ui.js";
import {
  ProjectProfileSwitcher,
  type ProjectProfilePreview,
} from "../components/ProjectProfileSwitcher.js";
import "./Portfolio.css";
import { ConfigurationDialog } from "../components/ConfigurationDialog.js";

function stateColor(state: string): string {
  if (state === "paused") return "var(--warning)";
  return itemStatusColor(state);
}

export function Portfolio() {
  const { setProjectProfileName, setProjectProfileId } = useContext(AppContext);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [projects, setProjects] = useState<Map<string, ProjectData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activeProfileId, setActiveProfileId] = useState("personal");
  const [profiles, setProfiles] = useState<ProjectProfilePreview[]>([
    { id: "personal", name: "Personal", color: "#2563eb", projectIds: [] },
  ]);
  const [configurationOpen, setConfigurationOpen] = useState(false);

  useEffect(() => {
    fetchRegistry()
      .then(async (reg) => {
        setRegistry(reg);
        setProfiles((current) => current.map((profile) =>
          profile.id === "personal"
            ? { ...profile, projectIds: reg.projects.map((project) => project.id) }
            : profile,
        ));
        const entries = await Promise.all(
          reg.projects.map(async (p) => {
            try {
              const data = await fetchProject(p.id);
              return [p.id, data] as [string, ProjectData];
            } catch {
              return null;
            }
          })
        );
        setProjects(new Map(entries.filter((e): e is [string, ProjectData] => e !== null)));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" from Konductor?\n\nRemoves the registry entry, .konductor/ and konductor.config.json.`)) return;
    setDeleting(id);
    try {
      await deleteProject(id);
      setRegistry((prev) => prev ? { ...prev, projects: prev.projects.filter((p) => p.id !== id) } : prev);
      setProjects((prev) => { const next = new Map(prev); next.delete(id); return next; });
    } catch (e) {
      alert(`Delete failed: ${String(e)}`);
    } finally {
      setDeleting(null);
    }
  }

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]!;
  const profileEntries = (registry?.projects ?? []).filter((entry) => activeProfile.projectIds.includes(entry.id));

  useEffect(() => {
    setProjectProfileName(activeProfile.name);
    setProjectProfileId(activeProfile.id);
  }, [activeProfile.id, activeProfile.name, setProjectProfileId, setProjectProfileName]);

  function createProfile(name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "profile";
    let id = base;
    let suffix = 2;
    while (profiles.some((profile) => profile.id === id)) id = `${base}-${suffix++}`;
    const next: ProjectProfilePreview = {
      id,
      name,
      color: ["#7c3aed", "#c2410c", "#047857", "#be185d"][profiles.length % 4]!,
      projectIds: [],
    };
    setProfiles((current) => [...current, next]);
    setActiveProfileId(id);
  }

  return (
    <>
      <div className="k-toolbar">
        <span className="k-toolbar__title">Projects</span>
        <span className="k-faint k-num">{loading ? "" : profileEntries.length}</span>
      </div>

      <div className="k-page">
        {loading && <p className="k-loading">Loading…</p>}

        {!loading && profileEntries.length === 0 && (
          <div className="pf__empty">
            <span>No projects in {activeProfile.name}.</span>
            <code>konductor init</code>
          </div>
        )}

        {!loading && profileEntries.length > 0 && (
          <div className="k-table-scroll">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>State</th>
                  <th>Phase</th>
                  <th className="k-num">Blockers</th>
                  <th className="k-num k-hide-sm">Deps</th>
                  <th className="k-num">Agents</th>
                  <th>Sync</th>
                  <th className="k-num k-hide-sm">Input tokens</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {profileEntries.map((entry) => {
                  const pd = projects.get(entry.id);
                  const snap = pd?.status ?? null;
                  const tel = pd?.telemetry ?? null;
                  const activeRuns = pd?.runs.filter((run) => run.status === "running" || run.status === "queued").length ?? 0;
                  const moved = entry.reachable === false;
                  const blockers = snap?.issues.blockers.length ?? 0;
                  return (
                    <tr key={entry.id} style={moved ? { opacity: 0.6 } : undefined}>
                      <td>
                        <Link to={`/project/${entry.id}`} className="pf__name">{entry.name}</Link>
                        {moved && <span className="pf__moved" title={`Not found at ${entry.repo_path}`}>moved</span>}
                      </td>
                      <td style={{ color: stateColor(snap?.status.state ?? "todo") }}>{snap?.status.state ?? "—"}</td>
                      <td className="k-muted">{snap?.status.current_phase_id ?? "—"}</td>
                      <td className="k-num" style={{ color: blockers > 0 ? "var(--danger)" : "var(--text-secondary)", fontWeight: blockers > 0 ? 600 : 400 }}>
                        {snap ? blockers : "—"}
                      </td>
                      <td className="k-num k-muted k-hide-sm">{snap?.issues.external_dependencies.length ?? "—"}</td>
                      <td className="k-num" style={{ color: activeRuns > 0 ? "var(--accent)" : "var(--text-secondary)" }}>{activeRuns}</td>
                      <td className="k-muted">{relativeTime(entry.last_sync)}</td>
                      <td className="k-num k-hide-sm">{tel?.input_tokens?.toLocaleString() ?? "—"}</td>
                      <td>
                        <div className="pf__actions">
                          <Link to={`/project/${entry.id}?info=1`} className="k-btn k-btn--ghost k-btn--icon k-btn--sm k-mono" title="Paths">i</Link>
                          <button
                            type="button"
                            className="k-btn k-btn--ghost k-btn--icon k-btn--sm pf__delete"
                            disabled={deleting === entry.id}
                            title={`Delete ${entry.name}`}
                            onClick={() => handleDelete(entry.id, entry.name)}
                          >
                            {deleting === entry.id ? "…" : "✕"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ProjectProfileSwitcher
        activeProfileId={activeProfileId}
        profiles={profiles}
        onSelect={setActiveProfileId}
        onCreate={createProfile}
        onConfigure={() => setConfigurationOpen(true)}
      />
      <ConfigurationDialog
        open={configurationOpen}
        scope={{
          type: "project_space",
          id: activeProfile.id,
          label: activeProfile.name,
          projectIds: activeProfile.projectIds,
        }}
        onClose={() => setConfigurationOpen(false)}
      />
    </>
  );
}
