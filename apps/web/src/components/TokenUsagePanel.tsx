import React, { useState } from "react";
import type { TelemetrySnapshot } from "../lib/types.js";

function signalColor(status: string): string {
  switch (status) {
    case "verified": return "var(--success)";
    case "best_effort": return "var(--warning)";
    default: return "var(--text-tertiary)";
  }
}

function formatN(n: number | null | undefined): string {
  return n == null ? "n/a" : n.toLocaleString();
}

function formatCost(n: number | null | undefined): string {
  return n == null ? "n/a" : `$${n.toFixed(4)}`;
}

interface TokenUsagePanelProps {
  telemetry: TelemetrySnapshot | null;
  onReset?: () => Promise<void>;
}

export function TokenUsagePanel({ telemetry, onReset }: TokenUsagePanelProps) {
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  async function resetUsage() {
    if (!onReset) return;
    if (!window.confirm("Reset token, request and cost counters for this project?")) return;
    setResetting(true);
    setResetError(null);
    try {
      await onReset();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error));
    } finally {
      setResetting(false);
    }
  }

  const metrics = telemetry
    ? ([
        { label: "Input", value: formatN(telemetry.input_tokens), key: "input_tokens" },
        { label: "Output", value: formatN(telemetry.output_tokens), key: "output_tokens" },
        { label: "Cache read", value: formatN(telemetry.cache_read_tokens), key: "cache_read_tokens" },
        { label: "Cache write", value: formatN(telemetry.cache_write_tokens), key: "cache_write_tokens" },
        { label: "Requests", value: formatN(telemetry.request_count), key: "request_count" },
        { label: "Cost", value: formatCost(telemetry.cost_usd), key: "cost_usd" },
      ] as const).filter(({ key }) => (telemetry.signal_availability[key] ?? "unavailable") !== "unavailable")
    : [];

  return (
    <details className="k-section" open>
      <summary className="k-section__header k-section__summary">
        <span className="k-chevron" aria-hidden="true">›</span>
        Model usage
        <span className="k-spacer" />
        {telemetry && onReset ? (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={resetting} onClick={(event) => { event.preventDefault(); void resetUsage(); }}>
            {resetting ? "Resetting…" : "Reset"}
          </button>
        ) : null}
      </summary>
      {!telemetry || metrics.length === 0 ? (
        <p className="k-empty" style={{ padding: 10 }}>No telemetry</p>
      ) : (
        <div className="k-metrics">
          {metrics.map(({ label, value, key }) => {
            const signal = telemetry.signal_availability[key] ?? "unavailable";
            return (
              <div key={key} className="k-metric">
                <span className="k-metric__label">{label}</span>
                <span className="k-metric__value">{value}</span>
                <span className="k-metric__sub" style={{ color: signalColor(signal) }}>{signal.replace("_", " ")}</span>
              </div>
            );
          })}
        </div>
      )}
      {resetError ? <p className="k-error" style={{ padding: "0 10px 8px" }}>{resetError}</p> : null}
    </details>
  );
}
