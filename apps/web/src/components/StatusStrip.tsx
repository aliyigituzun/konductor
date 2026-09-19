import React from "react";
import type { StatusSnapshot } from "../lib/types.js";
import "./StatusStrip.css";

interface StatusStripProps {
  snap: StatusSnapshot;
  activeRuns: number;
  onShowInfo: () => void;
}

export function StatusStrip({ snap, activeRuns, onShowInfo }: StatusStripProps) {
  const blockerCount = snap.issues.blockers.length;
  return (
    <div className="strip">
      <div className="strip__item">
        <span className="strip__label">Phase</span>
        <span className="strip__value">{snap.status.current_phase_id ?? "—"}</span>
      </div>
      <div className="strip__item">
        <span className="strip__label">Blockers</span>
        <span className="strip__value" style={{ color: blockerCount > 0 ? "var(--danger)" : "var(--success)" }}>
          {blockerCount}
        </span>
      </div>
      <div className="strip__item">
        <span className="strip__label">Agents</span>
        <span className="strip__value">{activeRuns}</span>
      </div>
      <span className="k-spacer" />
      <button
        type="button"
        className="k-btn k-btn--ghost k-btn--icon k-btn--sm k-mono"
        onClick={onShowInfo}
        aria-label="Project paths"
        title="Project paths"
      >
        i
      </button>
    </div>
  );
}
