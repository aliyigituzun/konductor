import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchHostHealth, formatApiError, type HostHealth } from "../lib/registry.js";
import type { KonductorConfig, RunSummary, StatusSnapshot } from "../lib/types.js";

const MAX_VISIBLE_FEATURES = 8;

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
  container: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: 16,
  },
  empty: {
    color: "var(--text-tertiary)",
    fontSize: 13,
    padding: "24px 0",
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.6fr) minmax(320px, 0.9fr)",
    gap: 18,
    alignItems: "start",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 16,
  },
  card: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    boxShadow: "var(--shadow-soft)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  cardHeaderMeta: {
    display: "grid",
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  badge: {
    fontSize: 11,
    fontWeight: 500,
    padding: "2px 8px",
    borderRadius: 12,
    background: "var(--bg-panel-alt)",
    color: "var(--text-tertiary)",
  },
  categoryLink: {
    fontSize: 12,
    fontWeight: 600,
    color: "#0f766e",
    textDecoration: "none",
  },
  progressBar: {
    height: 3,
    background: "var(--bg-panel-alt)",
    borderRadius: 2,
    marginBottom: 12,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "#0284c7",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  itemList: {
    display: "grid",
    maxHeight: 360,
    overflowY: "auto",
    scrollbarGutter: "stable",
  },
  overflowHint: {
    marginTop: 10,
    fontSize: 11,
    color: "var(--text-tertiary)",
  },
  itemButton: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 10px",
    borderTop: "1px solid var(--border-subtle)",
    background: "none",
    borderLeft: "2px solid transparent",
    borderRight: "none",
    borderBottom: "none",
    borderTopStyle: "solid",
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
  },
  itemButtonActive: {
    background: "var(--bg-panel)",
    borderLeft: "2px solid #0284c7",
  },
  itemDot: {
    width: 14,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: 700,
    marginTop: 1,
  },
  itemTitle: {
    flex: 1,
    fontSize: 13,
    color: "var(--text-primary)",
    lineHeight: 1.4,
  },
  launcher: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    boxShadow: "var(--shadow-soft)",
    position: "sticky",
    top: 72,
  },
  launcherTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: 12,
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
  meta: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 14,
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    color: "var(--text-primary)",
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
  textarea: {
    width: "100%",
    minHeight: 130,
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
    color: "var(--text-primary)",
    resize: "vertical",
    marginBottom: 12,
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
  error: {
    fontSize: 12,
    color: "var(--danger)",
    marginBottom: 10,
  },
  callout: {
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 12,
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
  divider: {
    height: 1,
    background: "var(--border-subtle)",
    margin: "14px 0 16px",
  },
};

interface LaunchPayload {
  feature_item_id: string;
  profile_id: string;
  prompt_packs: string[];
  prompt: string;
}

interface FeaturesPanelProps {
  projectId: string;
  snap: StatusSnapshot | null;
  config: KonductorConfig | null;
  onStartRun: (payload: LaunchPayload) => Promise<RunSummary>;
  onCreateFeature: (payload: {
    title: string;
    description?: string;
    category_id?: string;
    category_title?: string;
  }) => Promise<{ category_id: string; feature_item_id: string }>;
}

export function FeaturesPanel({ projectId, snap, config, onStartRun, onCreateFeature }: FeaturesPanelProps) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState(
    config?.agents?.default_profile ?? "default-profile",
  );
  const [selectedPacks, setSelectedPacks] = useState<string[]>(
    (config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id),
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [featureTitle, setFeatureTitle] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [categoryMode, setCategoryMode] = useState<"existing" | "new">("existing");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [newCategoryTitle, setNewCategoryTitle] = useState("");
  const [creatingFeature, setCreatingFeature] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [hostHealth, setHostHealth] = useState<HostHealth | null>(null);

  const features = snap?.features;
  const categories = features ?? [];
  const selectedItem = useMemo(() => {
    if (!features || !selectedItemId) return null;
    return (
      features
        .flatMap((category) =>
          category.items.map((item) => ({
            category_title: category.title,
            ...item,
          })),
        )
        .find((item) => item.id === selectedItemId) ?? null
    );
  }, [features, selectedItemId]);

  useEffect(() => {
    if (categoryMode === "existing" && categories.length === 0) {
      setCategoryMode("new");
    }
    if (categoryMode === "existing" && categories.length > 0 && !selectedCategoryId) {
      setSelectedCategoryId(categories[0]!.id);
    }
  }, [categories, categoryMode, selectedCategoryId]);

  useEffect(() => {
    setSelectedProfileId(config?.agents?.default_profile ?? "default-profile");
    setSelectedPacks((config?.agents?.prompt_packs ?? []).slice(0, 1).map((pack) => pack.id));
  }, [config]);

  useEffect(() => {
    fetchHostHealth()
      .then(setHostHealth)
      .catch((event) => setError(formatApiError(event)));
  }, []);

  async function handleSubmit() {
    if (!selectedItem || !prompt.trim()) {
      setError("Select one feature item and enter a prompt.");
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
      setLaunchMessage("Sending run request to Konductor host...");
      const run = await onStartRun({
        feature_item_id: selectedItem.id,
        profile_id: selectedProfileId,
        prompt_packs: selectedPacks,
        prompt,
      });
      setPrompt("");
      setLaunchMessage(
        `Run ${run.id} started for "${selectedItem.title}". Open the Agents tab to watch the terminal stream.`,
      );
    } catch (event) {
      setError(formatApiError(event));
      setLaunchMessage(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateFeature() {
    if (!featureTitle.trim()) {
      setCreateError("Enter a feature title.");
      return;
    }
    if (categoryMode === "existing" && !selectedCategoryId) {
      setCreateError("Choose a category or create a new one.");
      return;
    }
    if (categoryMode === "new" && !newCategoryTitle.trim()) {
      setCreateError("Enter a category title.");
      return;
    }
    setCreatingFeature(true);
    setCreateError(null);
    setCreateMessage(null);
    try {
      const payload: {
        title: string;
        description?: string;
        category_id?: string;
        category_title?: string;
      } = {
        title: featureTitle.trim(),
      };
      const description = featureDescription.trim();
      if (description) payload.description = description;
      if (categoryMode === "existing") {
        payload.category_id = selectedCategoryId;
      } else {
        payload.category_title = newCategoryTitle.trim();
      }
      const created = await onCreateFeature(payload);
      setSelectedItemId(created.feature_item_id);
      if (categoryMode === "new") {
        setSelectedCategoryId(created.category_id);
        setCategoryMode("existing");
      }
      setCreateMessage(`Added feature "${featureTitle.trim()}" as todo and selected it for the next agent launch.`);
      setFeatureTitle("");
      setFeatureDescription("");
      setNewCategoryTitle("");
      setPrompt((current) => current || `Implement feature: ${featureTitle.trim()}`);
    } catch (event) {
      setCreateError(formatApiError(event));
    } finally {
      setCreatingFeature(false);
    }
  }

  const hostMessage = hostHealth?.running
    ? `Host is running on port ${hostHealth.port}. Active runs: ${hostHealth.running_runs.length}.`
    : `${hostHealth?.error ?? "Konductor host is not running."}${hostHealth?.hint ? `\nHint: ${hostHealth.hint}` : ""}`;
  const hostTone = hostHealth?.running ? {
    borderColor: "rgba(15, 118, 110, 0.24)",
    background: "rgba(15, 118, 110, 0.08)",
    color: "var(--text-primary)",
  } : {
    borderColor: "rgba(185, 28, 28, 0.22)",
    background: "rgba(185, 28, 28, 0.08)",
    color: "var(--danger)",
  };

  return (
    <div style={s.container}>
      <div style={s.sectionTitle}>Features</div>
      <div style={s.layout}>
        <div style={s.grid}>
          {categories.length === 0 ? (
            <div style={s.card}>
              <p style={s.empty}>
                No features exist yet. Create one from the panel on the right, then launch an agent against it.
              </p>
            </div>
          ) : categories.map((cat) => {
            const done = cat.items.filter((i) => i.status === "done").length;
            const total = cat.items.length;
            const pct = total > 0 ? done / total : 0;

            return (
              <div key={cat.id} style={s.card}>
                <div style={s.cardHeader}>
                  <div style={s.cardHeaderMeta}>
                    <span style={s.cardTitle}>{cat.title}</span>
                    <Link style={s.categoryLink} to={`/project/${projectId}/features/${cat.id}`}>
                      Open category
                    </Link>
                  </div>
                  <span style={s.badge}>{done}/{total}</span>
                </div>
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${pct * 100}%` }} />
                </div>
                <div style={s.itemList}>
                  {cat.items.map((item) => (
                    <button
                      key={item.id}
                      style={{
                        ...s.itemButton,
                        ...(selectedItemId === item.id ? s.itemButtonActive : {}),
                      }}
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <span style={{ ...s.itemDot, color: statusColor(item.status) }}>
                        {statusDot(item.status)}
                      </span>
                      <span style={s.itemTitle}>{item.title}</span>
                    </button>
                  ))}
                </div>
                {cat.items.length > MAX_VISIBLE_FEATURES && (
                  <div style={s.overflowHint}>
                    Showing roughly {MAX_VISIBLE_FEATURES} items at a time. Scroll for the rest.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={s.launcher}>
          {hostHealth && (
            <div style={{ ...s.callout, ...hostTone }}>
              <span style={s.calloutTitle}>Host Status</span>
              {hostMessage}
            </div>
          )}
          <div style={s.launcherTitle}>Add feature</div>
          <span style={s.label}>Category</span>
          <select
            style={s.select}
            value={categoryMode === "new" ? "__new__" : selectedCategoryId}
            onChange={(event) => {
              if (event.target.value === "__new__") {
                setCategoryMode("new");
              } else {
                setCategoryMode("existing");
                setSelectedCategoryId(event.target.value);
              }
            }}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>{category.title}</option>
            ))}
            <option value="__new__">Create new category</option>
          </select>

          {categoryMode === "new" && (
            <>
              <span style={s.label}>New Category Title</span>
              <textarea
                style={{ ...s.textarea, minHeight: 70 }}
                value={newCategoryTitle}
                onChange={(event) => setNewCategoryTitle(event.target.value)}
                placeholder="Payments, API, Dashboard, Mobile..."
              />
            </>
          )}

          <span style={s.label}>Feature Title</span>
          <textarea
            style={{ ...s.textarea, minHeight: 70 }}
            value={featureTitle}
            onChange={(event) => setFeatureTitle(event.target.value)}
            placeholder="New feature to be tracked and worked on"
          />

          <span style={s.label}>Description</span>
          <textarea
            style={{ ...s.textarea, minHeight: 96 }}
            value={featureDescription}
            onChange={(event) => setFeatureDescription(event.target.value)}
            placeholder="Optional implementation notes, scope, or acceptance criteria"
          />
          {createError && <div style={s.error}>{createError}</div>}
          {createMessage && (
            <div style={{ ...s.callout, borderColor: "rgba(15, 118, 110, 0.24)", background: "rgba(15, 118, 110, 0.08)" }}>
              <span style={s.calloutTitle}>Feature Added</span>
              {createMessage}
            </div>
          )}
          <button style={s.secondaryButton} disabled={creatingFeature} onClick={handleCreateFeature}>
            {creatingFeature ? "Adding…" : "Add feature"}
          </button>

          <div style={s.divider} />

          <div style={s.launcherTitle}>Start agent from feature</div>
          {!selectedItem ? (
            <p style={s.empty}>Select one feature item from the left to launch an agent against it.</p>
          ) : (
            <>
              <span style={s.label}>Selected Feature</span>
              <div style={s.meta}>
                <strong>{selectedItem.title}</strong><br />
                {selectedItem.category_title} · {selectedItem.status}
                {selectedItem.description ? <><br />{selectedItem.description}</> : null}
              </div>

              <span style={s.label}>Profile</span>
              <select
                style={s.select}
                value={selectedProfileId}
                onChange={(event) => setSelectedProfileId(event.target.value)}
              >
                {(config?.agents?.profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.title}</option>
                ))}
              </select>

              <span style={s.label}>Prompt Packs</span>
              <div style={s.checklist}>
                {(config?.agents?.prompt_packs ?? []).map((pack) => {
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

              <span style={s.label}>Prompt</span>
              <textarea
                style={s.textarea}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Tell the selected agent what to do with this feature item."
              />
              {error && <div style={s.error}>{error}</div>}
              {launchMessage && (
                <div style={{ ...s.callout, borderColor: "rgba(2, 132, 199, 0.25)", background: "rgba(2, 132, 199, 0.08)" }}>
                  <span style={s.calloutTitle}>Agent Launch</span>
                  {launchMessage}
                </div>
              )}
              <button style={s.button} disabled={submitting} onClick={handleSubmit}>
                {submitting ? "Starting…" : "Start agent"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
