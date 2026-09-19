import React, { useState } from "react";
import type { Decision, KonductorConfig, StatusSnapshot } from "../../lib/types.js";
import { DecisionDialog } from "./DecisionDialog.js";
import "./Decisions.css";

interface FeatureDecisionsProps {
  projectId: string;
  featureItemId: string;
  decisions: Decision[];
  snap: StatusSnapshot | null;
  config: KonductorConfig | null;
  onChanged: () => Promise<void>;
}

export function decisionsForFeature(decisions: Decision[], featureItemId: string): Decision[] {
  return decisions.filter((decision) => decision.feature_item_ids.includes(featureItemId));
}

/** Decisions tied to one feature, with their outcome; each opens the decision dialog. */
export function FeatureDecisions({ projectId, featureItemId, decisions, snap, config, onChanged }: FeatureDecisionsProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const linked = decisionsForFeature(decisions, featureItemId);
  const active = openId ? decisions.find((decision) => decision.id === openId) ?? null : null;
  if (linked.length === 0) return null;
  return (
    <div className="k-field">
      <span className="k-label">Decisions <span className="k-faint">{linked.length}</span></span>
      <div className="dc__feature-decisions">
        {linked.map((decision) => {
          const chosen = decision.options.find((option) => option.id === decision.outcome?.option_id);
          return (
            <button key={decision.id} type="button" className="dc__feature-decision" onClick={() => setOpenId(decision.id)}>
              <span className="k-glyph" style={{ color: decision.status === "resolved" ? "var(--success)" : "var(--warning)" }}>
                {decision.status === "resolved" ? "✓" : "?"}
              </span>
              <span className="dc__feature-decision-title">{decision.title}</span>
              <span className="dc__feature-decision-outcome k-truncate">
                {decision.status === "resolved" ? `→ ${decision.outcome?.answer?.split("\n")[0] ?? chosen?.title ?? decision.outcome?.option_id}` : "awaiting decision"}
              </span>
            </button>
          );
        })}
      </div>
      {active ? (
        <DecisionDialog
          key={active.id}
          projectId={projectId}
          decision={active}
          snap={snap}
          config={config}
          onClose={() => setOpenId(null)}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
