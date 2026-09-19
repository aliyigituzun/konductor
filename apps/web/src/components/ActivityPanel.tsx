import React from "react";
import type { TelemetrySnapshot } from "../lib/types.js";

interface ActivityPanelProps {
  telemetry: TelemetrySnapshot | null;
}

/** Tool and file activity from the latest telemetry snapshot. Hidden when there is none. */
export function ActivityPanel({ telemetry }: ActivityPanelProps) {
  if (!telemetry) return null;
  const tools = telemetry.top_tools;
  const files = telemetry.top_files;
  if (tools.length === 0 && files.length === 0) return null;

  return (
    <div className="act">
      {tools.length > 0 && (
        <section className="k-section">
          <div className="k-section__header">Tools<span className="k-section__count">{tools.length}</span></div>
          <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
            <table className="k-table k-table--static">
              <thead><tr><th>Tool</th><th className="k-num">Count</th><th>Signal</th></tr></thead>
              <tbody>
                {tools.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td className="k-num">{t.count}</td>
                    <td className="k-faint" style={{ fontSize: 11 }}>{t.signal_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {files.length > 0 && (
        <section className="k-section">
          <div className="k-section__header">Files<span className="k-section__count">{files.length}</span></div>
          <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
            <table className="k-table k-table--static">
              <thead><tr><th>Path</th><th className="k-num">Reads</th><th className="k-num">Writes</th><th>Signal</th></tr></thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.path}>
                    <td className="k-mono">{f.path}</td>
                    <td className="k-num">{f.reads}</td>
                    <td className="k-num">{f.writes}</td>
                    <td className="k-faint" style={{ fontSize: 11 }}>{f.signal_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
