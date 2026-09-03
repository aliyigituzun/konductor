import React, { useContext, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppContext } from "../AppContext.js";
import { ProjectInfoModal } from "../components/ProjectInfoModal.js";
import { StatusStrip } from "../components/StatusStrip.js";
import {
  createProjectFeature,
  fetchHostHealth,
  fetchProject,
  formatApiError,
  startProjectRun,
  type HostHealth,
  type ProjectData,
} from "../lib/registry.js";
import type { FeatureCategory, KonductorConfig } from "../lib/types.js";

type ViewMode = "list" | "tree";

function statusColor(status: string): string {
  switch (status) {
    case "done": return "var(--success)";
    case "in_progress": return "#0284c7";
    case "blocked": return "var(--danger)";
    default: return "var(--text-tertiary)";
  }
}

function statusDot(status: string): string {
  switch (status) {
    case "done": return "✓";
    case "in_progress": return "▶";
    case "blocked": return "✗";
    default: return "·";
  }
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: "24px 32px", maxWidth: 1320, margin: "0 auto" },
  loading: { color: "var(--text-tertiary)", fontSize: 13, padding: "24px 0" },
  error: { color: "var(--danger)", fontSize: 13, padding: "24px 0", whiteSpace: "pre-wrap" },
  shell: {
    display: "grid",
    gap: 18,
  },
  hero: {
    display: "grid",
    gap: 14,
    padding: 20,
    background: "linear-gradient(135deg, rgba(15,118,110,0.12), rgba(2,132,199,0.08))",
    border: "1px solid rgba(15, 118, 110, 0.18)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-soft)",
  },
  backLink: {
    fontSize: 12,
    fontWeight: 600,
    color: "#0f766e",
    textDecoration: "none",
    width: "fit-content",
  },
  heroTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  titleBlock: {
    display: "grid",
    gap: 8,
  },
  title: {
    fontSize: 28,
    lineHeight: 1.1,
    letterSpacing: "-0.03em",
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  },
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: 0,
    maxWidth: 760,
  },
  summaryGrid: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  summaryBadge: {
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.72)",
    border: "1px solid rgba(15, 118, 110, 0.12)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  toggle: {
    display: "inline-flex",
    gap: 4,
    padding: 4,
    borderRadius: 12,
    border: "1px solid var(--border-subtle)",
    background: "rgba(255,255,255,0.82)",
  },
  toggleButton: {
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  toggleButtonActive: {
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    boxShadow: "0 1px 2px rgba(16,24,40,0.08)",
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 0.85fr) minmax(0, 1.35fr)",
    gap: 18,
    alignItems: "start",
  },
  railCard: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
  },
  railHeader: {
    padding: "16px 18px 14px",
    borderBottom: "1px solid var(--border-subtle)",
    display: "grid",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  },
  railHint: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  railBody: {
    maxHeight: "70vh",
    overflowY: "auto",
    scrollbarGutter: "stable",
    padding: 14,
  },
  list: {
    display: "grid",
    gap: 10,
  },
  featureButton: {
    width: "100%",
    textAlign: "left",
    padding: 14,
    borderRadius: 14,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    cursor: "pointer",
    display: "grid",
    gap: 8,
  },
  featureButtonActive: {
    borderColor: "rgba(2, 132, 199, 0.4)",
    background: "rgba(2, 132, 199, 0.08)",
  },
  featureMeta: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-tertiary)",
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.45,
  },
  featureDescription: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  },
  tree: {
    display: "grid",
    gap: 12,
  },
  treeRoot: {
    padding: 16,
    borderRadius: 16,
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
  },
  treeRootTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  treeBranchList: {
    listStyle: "none",
    margin: 0,
    padding: "12px 0 0 18px",
    borderLeft: "2px solid var(--border-subtle)",
    display: "grid",
    gap: 10,
  },
  treeItem: {
    position: "relative",
    paddingLeft: 14,
  },
  treeConnector: {
    position: "absolute",
    top: 18,
    left: -18,
    width: 18,
    height: 2,
    background: "var(--border-subtle)",
  },
  detailColumn: {
    display: "grid",
    gap: 18,
  },
  detailCard: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-lg)",
    padding: 18,
    boxShadow: "var(--shadow-soft)",
  },
  itemTitle: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "var(--text-primary)",
    marginBottom: 10,
  },
  itemSummary: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.65,
    marginBottom: 16,
  },
  statusPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    fontSize: 12,
    fontWeight: 600,
  },
  hostCallout: {
    borderRadius: 12,
    padding: "12px 14px",
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    marginBottom: 16,
  },
  calloutTitle: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  },
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
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
    background: "var(--bg-panel)",
    color: "var(--text-primary)",
    marginBottom: 12,
  },
  textarea: {
    width: "100%",
    minHeight: 110,
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    color: "var(--text-primary)",
    resize: "vertical",
    marginBottom: 12,
  },
  checklist: {
    display: "grid",
    gap: 8,
    marginBottom: 12,
  },
  checkRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 13,
    color: "var(--text-primary)",
  },
  button: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "none",
    background: "#0f766e",
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  secondaryButton: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  errorText: {
    fontSize: 12,
    color: "var(--danger)",
    marginBottom: 10,
    whiteSpace: "pre-wrap",
  },
  empty: {
    color: "var(--text-tertiary)",
    fontSize: 13,
    lineHeight: 1.6,
  },
  divider: {
    height: 1,
    background: "var(--border-subtle)",
    margin: "18px 0",
  },
};

function firstPromptPackIds(config: KonductorConfig | null): string[] {
  return (config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id);
}

function flattenCategoryItems(category: FeatureCategory) {
  return category.items.map((item) => item);
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

  const items = useMemo(() => (category ? flattenCategoryItems(category) : []), [category]);
  const selectedItem = useMemo(() => {
    if (!selectedItemId) return items[0] ?? null;
    return items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  }, [items, selectedItemId]);

  useEffect(() => {
    if (selectedItem?.id && selectedItem.id !== selectedItemId) {
      setSelectedItemId(selectedItem.id);
    }
  }, [selectedItem, selectedItemId]);

  async function refreshProject() {
    if (!id) return;
    await loadProject(id);
  }

  async function handleCreateFeature() {
    if (!id || !categoryId) return;
    if (!featureTitle.trim()) {
      setCreateError("Enter a feature title.");
      return;
    }
    setCreatingFeature(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const payload: {
        title: string;
        description?: string;
        category_id: string;
      } = {
        title: featureTitle.trim(),
        category_id: categoryId,
      };
      const description = featureDescription.trim();
      if (description) payload.description = description;
      const created = await createProjectFeature(id, payload);
      await refreshProject();
      setSelectedItemId(created.feature_item_id);
      setCreateMessage(`Added feature "${featureTitle.trim()}" as todo inside ${category?.title ?? "this category"}.`);
      setPrompt((current) => current || `Implement feature: ${featureTitle.trim()}`);
      setFeatureTitle("");
      setFeatureDescription("");
    } catch (event) {
      setCreateError(formatApiError(event));
    } finally {
      setCreatingFeature(false);
    }
  }

  async function handleStartRun() {
    if (!id || !selectedItem || !prompt.trim()) {
      setLaunchError("Select a feature and enter a prompt.");
      return;
    }
    setSubmitting(true);
    setLaunchError(null);
    setLaunchMessage("Checking Konductor host availability...");
    try {
      const health = await fetchHostHealth();
      setHostHealth(health);
      if (!health.running) {
        setLaunchError(
          [
            health.error ?? "Konductor host is not running.",
            health.hint ? `Hint: ${health.hint}` : null,
            ...(health.details ?? []),
          ]
            .filter(Boolean)
            .join("\n"),
        );
        setLaunchMessage(null);
        return;
      }
      setLaunchMessage("Sending category-scoped run request to Konductor host...");
      const run = await startProjectRun(id, {
        feature_item_id: selectedItem.id,
        profile_id: selectedProfileId,
        prompt_packs: selectedPacks,
        prompt,
        source: "dashboard",
      });
      await refreshProject();
      setPrompt("");
      setLaunchMessage(`Run ${run.id} started for "${selectedItem.title}". Open the Agents tab for live output.`);
    } catch (event) {
      setLaunchError(formatApiError(event));
      setLaunchMessage(null);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div style={{ padding: 32 }}><p style={s.loading}>Loading category…</p></div>;
  if (error) return <div style={{ padding: 32 }}><p style={s.error}>{error}</p></div>;
  if (!data) return <div style={{ padding: 32 }}><p style={s.error}>Project not found.</p></div>;
  if (!category) {
    return (
      <div style={s.page}>
        <p style={s.error}>Feature category not found.</p>
        <Link style={s.backLink} to={`/project/${id}?tab=features`}>Back to features</Link>
      </div>
    );
  }

  const doneCount = items.filter((item) => item.status === "done").length;
  const activeRuns = data.runs.filter((run) => run.status === "running" || run.status === "queued").length;
  const hostTone = hostHealth?.running ? {
    borderColor: "rgba(15, 118, 110, 0.24)",
    background: "rgba(15, 118, 110, 0.08)",
    color: "var(--text-primary)",
  } : {
    borderColor: "rgba(185, 28, 28, 0.22)",
    background: "rgba(185, 28, 28, 0.08)",
    color: "var(--danger)",
  };
  const hostMessage = hostHealth?.running
    ? `Host is running on port ${hostHealth.port}. Active runs: ${hostHealth.running_runs.length}.`
    : `${hostHealth?.error ?? "Konductor host is not running."}${hostHealth?.hint ? `\nHint: ${hostHealth.hint}` : ""}`;

  return (
    <div style={s.page}>
      {data.status && (
        <StatusStrip
          snap={data.status}
          lastSync={data.entry.last_sync}
          activeRuns={activeRuns}
          onShowInfo={() => setShowInfo(true)}
        />
      )}

      <div style={s.shell}>
        <section style={s.hero}>
          <Link style={s.backLink} to={`/project/${id}?tab=features`}>Back to all features</Link>
          <div style={s.heroTop}>
            <div style={s.titleBlock}>
              <h1 style={s.title}>{category.title}</h1>
              <p style={s.subtitle}>
                Category workspace for browsing, refining, and launching work against the tracked features in this stream.
              </p>
              <div style={s.summaryGrid}>
                <span style={s.summaryBadge}>{items.length} tracked feature{items.length === 1 ? "" : "s"}</span>
                <span style={s.summaryBadge}>{doneCount} done</span>
                <span style={s.summaryBadge}>{Math.max(items.length - doneCount, 0)} remaining</span>
              </div>
            </div>

            <div style={s.toggle}>
              <button
                style={{ ...s.toggleButton, ...(viewMode === "list" ? s.toggleButtonActive : {}) }}
                onClick={() => setViewMode("list")}
              >
                List View
              </button>
              <button
                style={{ ...s.toggleButton, ...(viewMode === "tree" ? s.toggleButtonActive : {}) }}
                onClick={() => setViewMode("tree")}
              >
                Tree View
              </button>
            </div>
          </div>
        </section>

        <div style={s.layout}>
          <section style={s.railCard}>
            <div style={s.railHeader}>
              <div style={s.sectionTitle}>{viewMode === "list" ? "Feature List" : "Feature Tree"}</div>
              <div style={s.railHint}>
                {viewMode === "list"
                  ? "Use the left rail to move through the features in this category."
                  : "This shows the current real hierarchy: category title at the root, tracked features as children."}
              </div>
            </div>
            <div style={s.railBody}>
              {items.length === 0 ? (
                <p style={s.empty}>This category has no tracked features yet. Add one from the panel on the right.</p>
              ) : viewMode === "list" ? (
                <div style={s.list}>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      style={{
                        ...s.featureButton,
                        ...(selectedItem?.id === item.id ? s.featureButtonActive : {}),
                      }}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <div style={s.featureMeta}>
                        <span style={{ color: statusColor(item.status), fontWeight: 700 }}>{statusDot(item.status)}</span>
                        <span>{item.status.replace("_", " ")}</span>
                      </div>
                      <div style={s.featureTitle}>{item.title}</div>
                      {item.description ? <div style={s.featureDescription}>{item.description}</div> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={s.tree}>
                  <div style={s.treeRoot}>
                    <div style={s.treeRootTitle}>{category.title}</div>
                    <ul style={s.treeBranchList}>
                      {items.map((item) => (
                        <li key={item.id} style={s.treeItem}>
                          <div style={s.treeConnector} />
                          <button
                            style={{
                              ...s.featureButton,
                              ...(selectedItem?.id === item.id ? s.featureButtonActive : {}),
                            }}
                            onClick={() => setSelectedItemId(item.id)}
                          >
                            <div style={s.featureMeta}>
                              <span style={{ color: statusColor(item.status), fontWeight: 700 }}>{statusDot(item.status)}</span>
                              <span>{item.status.replace("_", " ")}</span>
                            </div>
                            <div style={s.featureTitle}>{item.title}</div>
                            {item.description ? <div style={s.featureDescription}>{item.description}</div> : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </section>

          <div style={s.detailColumn}>
            <section style={s.detailCard}>
              <div style={s.sectionTitle}>Selected Feature</div>
              {selectedItem ? (
                <>
                  <div style={s.itemTitle}>{selectedItem.title}</div>
                  <div style={s.itemSummary}>
                    {selectedItem.description ?? "No extra description has been captured for this feature yet."}
                  </div>
                  <div style={s.statusPill}>
                    <span style={{ color: statusColor(selectedItem.status), fontWeight: 700 }}>{statusDot(selectedItem.status)}</span>
                    <span>{selectedItem.status.replace("_", " ")}</span>
                  </div>
                </>
              ) : (
                <p style={s.empty}>Select a feature from the left to inspect it and start work.</p>
              )}
            </section>

            <section style={s.detailCard}>
              {hostHealth && (
                <div style={{ ...s.hostCallout, ...hostTone }}>
                  <span style={s.calloutTitle}>Host Status</span>
                  {hostMessage}
                </div>
              )}

              <div style={s.sectionTitle}>Add Feature To Category</div>
              <span style={s.label}>Feature Title</span>
              <input
                style={s.input}
                value={featureTitle}
                onChange={(event) => setFeatureTitle(event.target.value)}
                placeholder="New feature to track in this category"
              />

              <span style={s.label}>Description</span>
              <textarea
                style={{ ...s.textarea, minHeight: 96 }}
                value={featureDescription}
                onChange={(event) => setFeatureDescription(event.target.value)}
                placeholder="Optional scope, implementation notes, or acceptance criteria"
              />
              {createError && <div style={s.errorText}>{createError}</div>}
              {createMessage && (
                <div style={{ ...s.hostCallout, borderColor: "rgba(15, 118, 110, 0.24)", background: "rgba(15, 118, 110, 0.08)" }}>
                  <span style={s.calloutTitle}>Feature Added</span>
                  {createMessage}
                </div>
              )}
              <button style={s.secondaryButton} disabled={creatingFeature} onClick={handleCreateFeature}>
                {creatingFeature ? "Adding…" : "Add feature"}
              </button>

              <div style={s.divider} />

              <div style={s.sectionTitle}>Start Agent</div>
              {selectedItem ? (
                <>
                  <span style={s.label}>Profile</span>
                  <select
                    style={s.input}
                    value={selectedProfileId}
                    onChange={(event) => setSelectedProfileId(event.target.value)}
                  >
                    {(data.config?.agents?.profiles ?? []).map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.title}</option>
                    ))}
                  </select>

                  <span style={s.label}>Prompt Packs</span>
                  <div style={s.checklist}>
                    {(data.config?.agents?.prompt_packs ?? []).map((pack) => {
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
                                setSelectedPacks((current) => current.filter((value) => value !== pack.id));
                              }
                            }}
                          />
                          <span>{pack.title}</span>
                        </label>
                      );
                    })}
                  </div>

                  <span style={s.label}>Prompt</span>
                  <textarea
                    style={s.textarea}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Tell the selected agent what to do with this feature."
                  />
                  {launchError && <div style={s.errorText}>{launchError}</div>}
                  {launchMessage && (
                    <div style={{ ...s.hostCallout, borderColor: "rgba(2, 132, 199, 0.25)", background: "rgba(2, 132, 199, 0.08)" }}>
                      <span style={s.calloutTitle}>Agent Launch</span>
                      {launchMessage}
                    </div>
                  )}
                  <button style={s.button} disabled={submitting} onClick={handleStartRun}>
                    {submitting ? "Starting…" : "Start agent"}
                  </button>
                </>
              ) : (
                <p style={s.empty}>Add or select a feature before launching an agent.</p>
              )}
            </section>
          </div>
        </div>
      </div>

      {showInfo && (
        <ProjectInfoModal
          paths={data.important_paths}
          onClose={() => setShowInfo(false)}
        />
      )}
    </div>
  );
}
