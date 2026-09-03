import type React from "react";

/**
 * Shared visual primitives.
 *
 * These lived as a ~320-line inline object duplicated across AgentsPanel,
 * FeaturesPanel and FeatureCategoryPage. One copy, consumed by all three, is what
 * keeps the three surfaces looking like the same product.
 */
export const s: Record<string, React.CSSProperties> = {
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

/** Colour for a live agent's status pill. */
export function agentStatusColor(status: string | null | undefined): string {
  switch (status) {
    case "working":
      return "#0284c7";
    case "idle":
      return "var(--success)";
    case "blocked":
      return "var(--warning)";
    case "dead":
      return "var(--danger)";
    case "done":
      return "var(--text-tertiary)";
    default:
      return "var(--text-tertiary)";
  }
}

/** Colour for a finished run's terminal status. */
export function runStatusColor(status: string): string {
  switch (status) {
    case "running":
    case "queued":
      return "#0284c7";
    case "succeeded":
      return "var(--success)";
    case "failed":
      return "var(--danger)";
    case "stopped":
      return "var(--warning)";
    default:
      return "var(--text-tertiary)";
  }
}

export function pill(color: string): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: "3px 9px",
    borderRadius: 999,
    color,
    background: "var(--bg-canvas)",
    border: `1px solid ${color}33`,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  };
}
