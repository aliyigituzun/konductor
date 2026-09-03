import React from "react";
import type { Blocker, DecisionNeeded, ExternalDependency } from "../lib/types.js";

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
    padding: "8px 12px",
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
    padding: "8px 12px",
    borderBottom: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    verticalAlign: "top",
  },
  empty: {
    fontSize: 13,
    color: "var(--text-tertiary)",
    padding: "12px 0",
  },
};

function severityColor(s: string): string {
  switch (s) {
    case "critical": return "var(--danger)";
    case "high": return "#c2410c";
    case "medium": return "var(--warning)";
    default: return "var(--text-tertiary)";
  }
}

interface BlockersPanelProps {
  blockers: Blocker[];
  decisions: DecisionNeeded[];
  dependencies: ExternalDependency[];
}

export function BlockersPanel({ blockers, decisions, dependencies }: BlockersPanelProps) {
  return (
    <>
      {/* Blockers */}
      <div style={s.container}>
        <div style={s.sectionTitle}>Blockers ({blockers.length})</div>
        {blockers.length === 0 ? (
          <p style={s.empty}>No blockers.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Severity</th>
                <th style={s.th}>Owner</th>
                <th style={s.th}>Summary</th>
                <th style={s.th}>Unblock Condition</th>
              </tr>
            </thead>
            <tbody>
              {blockers.map((b) => (
                <tr key={b.id}>
                  <td style={{ ...s.td, color: severityColor(b.severity), fontWeight: 500 }}>
                    {b.severity}
                  </td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>{b.owner ?? "—"}</td>
                  <td style={s.td}>{b.summary}</td>
                  <td style={{ ...s.td, color: "var(--text-secondary)", fontSize: 12 }}>
                    {b.unblock_condition ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Decisions Needed */}
      <div style={s.container}>
        <div style={s.sectionTitle}>Decisions Needed ({decisions.length})</div>
        {decisions.length === 0 ? (
          <p style={s.empty}>No pending decisions.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Impact</th>
                <th style={s.th}>Owner</th>
                <th style={s.th}>Summary</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td style={{ ...s.td, fontWeight: 500 }}>{d.impact}</td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>{d.owner ?? "—"}</td>
                  <td style={s.td}>{d.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* External Dependencies */}
      <div style={s.container}>
        <div style={s.sectionTitle}>External Dependencies ({dependencies.length})</div>
        {dependencies.length === 0 ? (
          <p style={s.empty}>No external dependencies.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Type</th>
                <th style={s.th}>Status</th>
                <th style={s.th}>Owner</th>
                <th style={s.th}>Summary</th>
              </tr>
            </thead>
            <tbody>
              {dependencies.map((d) => (
                <tr key={d.id}>
                  <td style={s.td}>{d.type}</td>
                  <td
                    style={{
                      ...s.td,
                      color:
                        d.status === "resolved"
                          ? "var(--success)"
                          : d.status === "blocked"
                          ? "var(--danger)"
                          : "var(--warning)",
                      fontWeight: 500,
                    }}
                  >
                    {d.status}
                  </td>
                  <td style={{ ...s.td, color: "var(--text-secondary)" }}>{d.owner ?? "—"}</td>
                  <td style={s.td}>{d.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
