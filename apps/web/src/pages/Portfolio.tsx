import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRegistry, fetchProject, deleteProject, type ProjectData } from "../lib/registry.js";
import type { Registry } from "../lib/types.js";

function relativeTime(isoStr: string | null): string {
  if (!isoStr) return "never";
  const ms = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function stateColor(state: string): string {
  switch (state) {
    case "in_progress": return "#0284c7";
    case "done": return "var(--success)";
    case "blocked": return "var(--danger)";
    case "paused": return "var(--warning)";
    default: return "var(--text-tertiary)";
  }
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: "24px 32px", maxWidth: 1200, margin: "0 auto" },
  title: { fontSize: 24, fontWeight: 600, marginBottom: 4 },
  subtitle: { fontSize: 13, color: "var(--text-tertiary)", marginBottom: 24 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    boxShadow: "var(--shadow-soft)",
    fontSize: 13,
  },
  th: {
    padding: "10px 16px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    background: "var(--bg-panel)",
    borderBottom: "1px solid var(--border-subtle)",
  },
  td: {
    padding: "10px 16px",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    verticalAlign: "middle",
  },
  link: {
    color: "var(--text-primary)",
    fontWeight: 500,
    textDecoration: "none",
  },
  loading: { color: "var(--text-tertiary)", fontSize: 13, padding: "24px 0" },
  deleteBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-tertiary)",
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 14,
    lineHeight: 1,
    transition: "color 0.15s",
  },
  empty: {
    textAlign: "center",
    padding: "48px 24px",
    color: "var(--text-tertiary)",
    fontSize: 13,
  },
  infoIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
    borderRadius: "50%",
    padding: 2,
    transition: "color 0.15s",
    lineHeight: 1,
  },
  movedBadge: {
    marginLeft: 8,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warning)",
    border: "1px solid var(--warning)",
    borderRadius: 4,
    padding: "1px 6px",
    whiteSpace: "nowrap",
    cursor: "help",
  },
};

export function Portfolio() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [projects, setProjects] = useState<Map<string, ProjectData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchRegistry()
      .then(async (reg) => {
        setRegistry(reg);
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
        const map = new Map(entries.filter((e): e is [string, ProjectData] => e !== null));
        setProjects(map);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}" from Konductor?\n\nThis will remove the registry entry, .konductor/ directory, and konductor.config.json. This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await deleteProject(id);
      setRegistry((prev) => prev ? { ...prev, projects: prev.projects.filter((p) => p.id !== id) } : prev);
      setProjects((prev) => { const next = new Map(prev); next.delete(id); return next; });
    } catch (e) {
      alert(`Failed to delete project: ${String(e)}`);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div style={s.page}>
      <h1 style={s.title}>Portfolio</h1>
      <p style={s.subtitle}>All Konductor-initialized projects on this machine</p>

      {loading && <p style={s.loading}>Loading…</p>}

      {!loading && (!registry || registry.projects.length === 0) && (
        <div style={s.empty}>
          <p>No projects found.</p>
          <p style={{ marginTop: 8 }}>
            Run <code>konductor init</code> in a project directory to get started.
          </p>
        </div>
      )}

      {!loading && registry && registry.projects.length > 0 && (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Project</th>
              <th style={s.th}>State</th>
              <th style={s.th}>Phase</th>
              <th style={s.th}>Blockers</th>
              <th style={s.th}>Dependencies</th>
              <th style={s.th}>Agents</th>
              <th style={s.th}>Last Sync</th>
              <th style={s.th}>Input Tokens</th>
              <th style={s.th}>Info</th>
              <th style={{ ...s.th, width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {registry.projects.map((entry) => {
              const pd = projects.get(entry.id);
              const snap = pd?.status ?? null;
              const tel = pd?.telemetry ?? null;
              const activeRuns = pd?.runs.filter((run) => run.status === "running" || run.status === "queued").length ?? 0;
              const moved = entry.reachable === false;
              return (
                <tr key={entry.id} style={moved ? { opacity: 0.6 } : undefined}>
                  <td style={s.td}>
                    <Link to={`/project/${entry.id}`} style={s.link}>
                      {entry.name}
                    </Link>
                    {moved && (
                      <span style={s.movedBadge} title={`Not found at ${entry.repo_path}`}>
                        ⚠ moved
                      </span>
                    )}
                  </td>
                  <td style={{ ...s.td, color: stateColor(snap?.status.state ?? "todo") }}>
                    {snap?.status.state ?? "—"}
                  </td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>
                    {snap?.status.current_phase_id ?? "—"}
                  </td>
                  <td
                    style={{
                      ...s.td,
                      color:
                        (snap?.issues.blockers.length ?? 0) > 0
                          ? "var(--danger)"
                          : "var(--text-secondary)",
                      fontWeight: (snap?.issues.blockers.length ?? 0) > 0 ? 500 : 400,
                    }}
                  >
                    {snap?.issues.blockers.length ?? "—"}
                  </td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>
                    {snap?.issues.external_dependencies.length ?? "—"}
                  </td>
                  <td style={{ ...s.td, color: activeRuns > 0 ? "#0284c7" : "var(--text-secondary)" }}>
                    {activeRuns}
                  </td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>
                    {relativeTime(entry.last_sync)}
                  </td>
                  <td style={{ ...s.td, fontVariantNumeric: "tabular-nums" }}>
                    {tel?.input_tokens?.toLocaleString() ?? "—"}
                  </td>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <Link
                      to={`/project/${entry.id}?info=1`}
                      style={s.infoIcon}
                      title="View project paths"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#0284c7"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-tertiary)"; }}
                    >
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="7.5" cy="7.5" r="6.75" stroke="currentColor" strokeWidth="1.5"/>
                        <circle cx="7.5" cy="4.75" r="1" fill="currentColor"/>
                        <rect x="6.75" y="7" width="1.5" height="4.25" rx="0.75" fill="currentColor"/>
                      </svg>
                    </Link>
                  </td>
                  <td style={{ ...s.td, textAlign: "center" }}>
                    <button
                      style={{
                        ...s.deleteBtn,
                        opacity: deleting === entry.id ? 0.4 : 1,
                        color: deleting === entry.id ? "var(--text-tertiary)" : undefined,
                      }}
                      disabled={deleting === entry.id}
                      title={`Delete ${entry.name}`}
                      onClick={() => handleDelete(entry.id, entry.name)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--danger)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-tertiary)"; }}
                    >
                      {deleting === entry.id ? "…" : "✕"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
