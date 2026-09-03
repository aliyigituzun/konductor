import React from "react";
import type { TelemetrySnapshot } from "../lib/types.js";

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
    marginBottom: 12,
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
  },
  unavailable: {
    fontSize: 13,
    color: "var(--text-tertiary)",
    fontStyle: "italic",
  },
};

interface ActivityPanelProps {
  telemetry: TelemetrySnapshot | null;
}

export function ActivityPanel({ telemetry }: ActivityPanelProps) {
  if (!telemetry) {
    return (
      <div style={s.container}>
        <div style={s.sectionTitle}>File & Tool Activity</div>
        <p style={s.unavailable}>No telemetry data. Run konductor sync first.</p>
      </div>
    );
  }

  return (
    <>
      {telemetry.top_tools.length > 0 && (
        <div style={s.container}>
          <div style={s.sectionTitle}>Top Tools</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Tool</th>
                <th style={s.th}>Count</th>
                <th style={s.th}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.top_tools.map((t) => (
                <tr key={t.name}>
                  <td style={s.td}>{t.name}</td>
                  <td style={{ ...s.td, fontVariantNumeric: "tabular-nums" }}>{t.count}</td>
                  <td style={{ ...s.td, color: "var(--text-tertiary)", fontSize: 11 }}>
                    {t.signal_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {telemetry.top_files.length > 0 && (
        <div style={s.container}>
          <div style={s.sectionTitle}>File Activity</div>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Path</th>
                <th style={s.th}>Reads</th>
                <th style={s.th}>Writes</th>
                <th style={s.th}>Signal</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.top_files.map((f) => (
                <tr key={f.path}>
                  <td style={{ ...s.td, fontFamily: "monospace", fontSize: 12 }}>{f.path}</td>
                  <td style={{ ...s.td, fontVariantNumeric: "tabular-nums" }}>{f.reads}</td>
                  <td style={{ ...s.td, fontVariantNumeric: "tabular-nums" }}>{f.writes}</td>
                  <td style={{ ...s.td, color: "var(--text-tertiary)", fontSize: 11 }}>
                    {f.signal_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {telemetry.top_tools.length === 0 && telemetry.top_files.length === 0 && (
        <div style={s.container}>
          <div style={s.sectionTitle}>File & Tool Activity</div>
          <p style={s.unavailable}>
            No activity data in latest telemetry snapshot.
          </p>
        </div>
      )}
    </>
  );
}
