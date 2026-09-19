import React from "react";
import type { Blocker, ExternalDependency } from "../lib/types.js";

function severityColor(s: string): string {
  switch (s) {
    case "critical": return "var(--danger)";
    case "high": return "var(--danger)";
    case "medium": return "var(--warning)";
    default: return "var(--text-tertiary)";
  }
}

function dependencyColor(status: string): string {
  if (status === "resolved") return "var(--success)";
  if (status === "blocked") return "var(--danger)";
  return "var(--warning)";
}

interface BlockersPanelProps {
  blockers: Blocker[];
  dependencies: ExternalDependency[];
}

function Table({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) {
  return (
    <section id={id} className="k-section st__anchor">
      <div className="k-section__header">{title}<span className="k-section__count">{count}</span></div>
      <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
        <table className="k-table k-table--static">{children}</table>
      </div>
    </section>
  );
}

/** Issue tables. Empty groups are omitted entirely. */
export function BlockersPanel({ blockers, dependencies }: BlockersPanelProps) {
  return (
    <>
      {blockers.length > 0 && (
        <Table id="sec-blockers" title="Blockers" count={blockers.length}>
          <thead>
            <tr><th>Severity</th><th>Owner</th><th>Summary</th><th>Unblock</th></tr>
          </thead>
          <tbody>
            {blockers.map((b) => (
              <tr key={b.id}>
                <td style={{ color: severityColor(b.severity), fontWeight: 600 }}>{b.severity}</td>
                <td className="k-muted">{b.owner ?? "—"}</td>
                <td>{b.summary}</td>
                <td className="k-muted">{b.unblock_condition ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {dependencies.length > 0 && (
        <Table id="sec-dependencies" title="Dependencies" count={dependencies.length}>
          <thead>
            <tr><th>Type</th><th>Status</th><th>Owner</th><th>Summary</th></tr>
          </thead>
          <tbody>
            {dependencies.map((d) => (
              <tr key={d.id}>
                <td>{d.type}</td>
                <td style={{ color: dependencyColor(d.status), fontWeight: 600 }}>{d.status}</td>
                <td className="k-muted">{d.owner ?? "—"}</td>
                <td>{d.summary}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
