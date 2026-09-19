import React, { useState } from "react";
import type { Decision, KonductorConfig, StatusSnapshot } from "../../lib/types.js";
import { DecisionDialog, impactColor } from "./DecisionDialog.js";
import "./Decisions.css";

interface DecisionsPanelProps {
  projectId: string;
  decisions: Decision[];
  snap: StatusSnapshot | null;
  config: KonductorConfig | null;
  onChanged: () => Promise<void>;
}

function chosenTitle(decision: Decision): string {
  if (decision.outcome?.answer) return decision.outcome.answer.split("\n")[0]!;
  const option = decision.options.find((candidate) => candidate.id === decision.outcome?.option_id);
  return option?.title ?? decision.outcome?.option_id ?? "—";
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Open decisions wait for the operator; resolved ones keep their outcome visible.
 * Every row opens the same dialog, which switches between resolve and read-only.
 */
export function DecisionsPanel({ projectId, decisions, snap, config, onChanged }: DecisionsPanelProps) {
  const [dialog, setDialog] = useState<{ open: true; decisionId: string | null } | null>(null);
  const open = decisions.filter((decision) => decision.status === "open");
  const resolved = decisions.filter((decision) => decision.status === "resolved");
  const active = dialog?.decisionId ? decisions.find((decision) => decision.id === dialog.decisionId) ?? null : null;

  return (
    <details id="sec-decisions" className="k-section st__anchor" open>
      <summary className="k-section__header k-section__summary">
        <span className="k-chevron" aria-hidden="true">›</span>
        Decisions
        <span className="k-section__count">{open.length}</span>
        <span className="k-spacer" />
        <button type="button" className="k-btn k-btn--sm" onClick={(event) => { event.preventDefault(); setDialog({ open: true, decisionId: null }); }}>New decision</button>
      </summary>

      {open.length === 0 && resolved.length === 0 ? (
        <p className="k-empty" style={{ padding: "12px 16px" }}>No decisions. Agents raise them through MCP, or record one here.</p>
      ) : null}

      {open.length > 0 ? (
        <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
          <table className="k-table dc__table">
            <thead>
              <tr><th>Impact</th><th>Owner</th><th>Decision</th><th className="k-num">Options</th><th className="k-num">Features</th></tr>
            </thead>
            <tbody>
              {open.map((decision) => (
                <tr key={decision.id} className="dc__row" onClick={() => setDialog({ open: true, decisionId: decision.id })}>
                  <td style={{ color: impactColor(decision.impact), fontWeight: 600 }}>{decision.impact}</td>
                  <td className="k-muted">{decision.owner ?? "—"}</td>
                  <td>
                    <button type="button" className="dc__row-btn">{decision.title}</button>
                    <div className="k-faint k-truncate dc__row-sub">{decision.question}</div>
                  </td>
                  <td className="k-num">{decision.kind === "open_ended" ? <span className="k-faint">open</span> : decision.options.length}</td>
                  <td className="k-num">{decision.feature_item_ids.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {resolved.length > 0 ? (
        <>
          <div className="dc__subhead">Resolved<span className="k-section__count">{resolved.length}</span></div>
          <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
            <table className="k-table dc__table">
              <thead>
                <tr><th>Resolved</th><th>Decision</th><th>Chosen</th><th className="k-num">Features</th><th>Agent</th></tr>
              </thead>
              <tbody>
                {resolved.map((decision) => (
                  <tr key={decision.id} className="dc__row" onClick={() => setDialog({ open: true, decisionId: decision.id })}>
                    <td className="k-muted">{decision.outcome ? shortDate(decision.outcome.resolved_at) : "—"}</td>
                    <td><button type="button" className="dc__row-btn">{decision.title}</button></td>
                    <td className="k-truncate" style={{ maxWidth: 320 }}><span className="k-glyph" style={{ color: "var(--success)" }}>✓</span> {chosenTitle(decision)}</td>
                    <td className="k-num">{decision.feature_item_ids.length}</td>
                    <td className="k-muted">{decision.outcome?.handoff_run_id ? <span className="k-mono">{decision.outcome.handoff_run_id.slice(0, 8)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {dialog ? (
        <DecisionDialog
          key={dialog.decisionId ?? "new"}
          projectId={projectId}
          decision={active}
          snap={snap}
          config={config}
          onClose={() => setDialog(null)}
          onChanged={onChanged}
        />
      ) : null}
    </details>
  );
}
