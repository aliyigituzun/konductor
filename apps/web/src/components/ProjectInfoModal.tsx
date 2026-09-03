import React from "react";
import type { ProjectImportantPaths } from "../lib/types.js";

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 16, 24, 0.48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 50,
  },
  modal: {
    width: "min(720px, 100%)",
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 18px",
    borderBottom: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.02em",
    color: "var(--text-primary)",
  },
  close: {
    border: "none",
    background: "none",
    color: "var(--text-secondary)",
    fontSize: 18,
    cursor: "pointer",
    lineHeight: 1,
  },
  body: {
    padding: 18,
    display: "grid",
    gap: 10,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "170px 1fr",
    gap: 12,
    alignItems: "start",
    fontSize: 13,
  },
  label: {
    color: "var(--text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontSize: 11,
    fontWeight: 600,
  },
  value: {
    color: "var(--text-primary)",
    wordBreak: "break-all",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
  },
};

interface ProjectInfoModalProps {
  paths: ProjectImportantPaths;
  onClose: () => void;
}

export function ProjectInfoModal({ paths, onClose }: ProjectInfoModalProps) {
  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={(event) => event.stopPropagation()}>
        <div style={s.header}>
          <div style={s.title}>Konductor Paths</div>
          <button style={s.close} onClick={onClose}>×</button>
        </div>
        <div style={s.body}>
          {Object.entries(paths).map(([key, value]) => (
            <div key={key} style={s.row}>
              <div style={s.label}>{key.replace(/_/g, " ")}</div>
              <div style={s.value}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
