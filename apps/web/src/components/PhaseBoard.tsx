import React, { useState } from "react";
import type { Phase } from "../lib/types.js";

function itemStatusColor(status: string): string {
  switch (status) {
    case "done": return "var(--success)";
    case "blocked": return "var(--danger)";
    case "in_progress": return "#0284c7";
    default: return "var(--text-tertiary)";
  }
}

function itemStatusIcon(status: string): string {
  switch (status) {
    case "done": return "✓";
    case "blocked": return "✗";
    case "in_progress": return "▶";
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
    marginBottom: 8,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 12,
  },
  phaseCard: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 12,
    boxShadow: "var(--shadow-soft)",
  },
  phaseTitle: {
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 8,
    color: "var(--text-primary)",
  },
  phaseStatus: {
    fontSize: 11,
    fontWeight: 500,
    padding: "1px 6px",
    borderRadius: 3,
    background: "var(--bg-panel-alt)",
    color: "var(--text-secondary)",
    display: "inline-block",
    marginBottom: 10,
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    padding: "4px 0",
    borderTop: "1px solid var(--border-subtle)",
    fontSize: 13,
  },
  itemIcon: {
    width: 14,
    flexShrink: 0,
    marginTop: 1,
    fontWeight: 600,
    fontSize: 12,
  },
  itemTitle: {
    flex: 1,
    color: "var(--text-primary)",
  },
  itemType: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  progressBar: {
    height: 3,
    background: "var(--bg-panel-alt)",
    borderRadius: 2,
    marginBottom: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--text-primary)",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  showDoneBtn: {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--text-tertiary)",
    background: "none",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-sm)",
    padding: "2px 8px",
    cursor: "pointer",
    lineHeight: 1.5,
  },
  seeMoreButton: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: 600,
    color: "#0b74b8",
    background: "none",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
    padding: 0,
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 16, 24, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 200,
  },
  modal: {
    width: "min(760px, 100%)",
    maxHeight: "calc(100vh - 80px)",
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
    display: "grid",
    gridTemplateRows: "auto 1fr",
  },
  modalHeader: {
    padding: 16,
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  modalBody: {
    padding: 16,
    overflowY: "auto",
    display: "grid",
    gap: 10,
  },
};

interface PhaseBoardProps {
  phases: Phase[];
}

export function PhaseBoard({ phases }: PhaseBoardProps) {
  const [showDone, setShowDone] = useState(false);
  const [openPhase, setOpenPhase] = useState<Phase | null>(null);
  const VISIBLE_ITEM_LIMIT = 5;

  if (phases.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.sectionTitle}>Phase Board</div>
        <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No phases defined yet.</p>
      </div>
    );
  }

  const doneCount = phases.filter((p) => p.status === "done").length;
  const visible = showDone ? phases : phases.filter((p) => p.status !== "done");

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div style={s.sectionTitle}>Phase Board</div>
        {doneCount > 0 && (
          <button style={s.showDoneBtn} onClick={() => setShowDone((v) => !v)}>
            {showDone ? `Hide completed` : `+${doneCount} completed`}
          </button>
        )}
      </div>
      <div style={s.grid}>
        {visible.map((phase) => {
          const done = phase.items.filter((i) => i.status === "done").length;
          const total = phase.items.length;
          const pct = total > 0 ? done / total : 0;
          const itemsToShow = phase.items.slice(0, VISIBLE_ITEM_LIMIT);
          const hiddenCount = total - itemsToShow.length;

          return (
            <div key={phase.id} style={s.phaseCard}>
              <div style={s.phaseTitle}>{phase.title}</div>
              <span style={s.phaseStatus}>{phase.status}</span>
              {total > 0 && (
                <div style={s.progressBar}>
                  <div style={{ ...s.progressFill, width: `${pct * 100}%` }} />
                </div>
              )}
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 6 }}>
                {done}/{total} items
              </div>
              {itemsToShow.map((item) => (
                <div key={item.id} style={s.item}>
                  <span
                    style={{
                      ...s.itemIcon,
                      color: itemStatusColor(item.status),
                    }}
                  >
                    {itemStatusIcon(item.status)}
                  </span>
                  <span style={s.itemTitle}>{item.title}</span>
                  <span style={s.itemType}>{item.type}</span>
                </div>
              ))}
              {hiddenCount > 0 && (
                <button style={s.seeMoreButton} onClick={() => setOpenPhase(phase)}>
                  View all {total} items
                </button>
              )}
            </div>
          );
        })}
      </div>

      {openPhase ? (
        <div style={s.modalOverlay} onClick={() => setOpenPhase(null)}>
          <div style={s.modal} onClick={(event) => event.stopPropagation()}>
            <div style={s.modalHeader}>
              <div style={s.modalTitle}>{openPhase.title}</div>
              <button style={s.seeMoreButton} onClick={() => setOpenPhase(null)}>
                Close
              </button>
            </div>
            <div style={s.modalBody}>
              {openPhase.items.length === 0 ? (
                <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No items in this phase.</p>
              ) : (
                openPhase.items.map((item) => (
                  <div key={item.id} style={s.item}>
                    <span
                      style={{
                        ...s.itemIcon,
                        color: itemStatusColor(item.status),
                      }}
                    >
                      {itemStatusIcon(item.status)}
                    </span>
                    <span style={s.itemTitle}>{item.title}</span>
                    <span style={s.itemType}>{item.type}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
