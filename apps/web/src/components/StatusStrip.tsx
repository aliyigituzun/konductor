import React from "react";
import type { StatusSnapshot } from "../lib/types.js";

function relativeTime(isoStr: string): string {
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

const styles: Record<string, React.CSSProperties> = {
  strip: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: "12px 16px",
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 16,
    boxShadow: "var(--shadow-soft)",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  label: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 500,
  },
  value: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-primary)",
  },
};

interface StatusStripProps {
  snap: StatusSnapshot;
  lastSync: string | null;
  activeRuns: number;
  onShowInfo: () => void;
}

export function StatusStrip({ snap, lastSync, activeRuns, onShowInfo }: StatusStripProps) {
  const blockerCount = snap.issues.blockers.length;
  return (
    <div style={styles.strip}>
      <div style={styles.item}>
        <span style={styles.label}>Project</span>
        <span style={styles.value}>{snap.project.name}</span>
      </div>
      <div style={styles.item}>
        <span style={styles.label}>State</span>
        <span style={{ ...styles.value, color: stateColor(snap.status.state) }}>
          {snap.status.state}
        </span>
      </div>
      <div style={styles.item}>
        <span style={styles.label}>Phase</span>
        <span style={styles.value}>{snap.status.current_phase_id ?? "—"}</span>
      </div>
      <div style={styles.item}>
        <span style={styles.label}>Blockers</span>
        <span
          style={{
            ...styles.value,
            color: blockerCount > 0 ? "var(--danger)" : "var(--success)",
          }}
        >
          {blockerCount}
        </span>
      </div>
      <div style={styles.item}>
        <span style={styles.label}>Active Agents</span>
        <span style={styles.value}>{activeRuns}</span>
      </div>
      {lastSync && (
        <div style={styles.item}>
          <span style={styles.label}>Last Sync</span>
          <span style={{ ...styles.value, color: "var(--text-secondary)" }}>
            {relativeTime(lastSync)}
          </span>
        </div>
      )}
      <button
        style={{
          marginLeft: "auto",
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-panel)",
          color: "var(--text-secondary)",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
        onClick={onShowInfo}
      >
        Info
      </button>
    </div>
  );
}
