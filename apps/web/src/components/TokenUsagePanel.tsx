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
  card: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 16,
    boxShadow: "var(--shadow-soft)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
    gap: 12,
  },
  metric: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  label: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  value: {
    fontSize: 20,
    fontWeight: 600,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  },
  signal: {
    fontSize: 10,
    padding: "1px 5px",
    borderRadius: 3,
    display: "inline-block",
    marginTop: 2,
  },
  unavailable: {
    fontSize: 13,
    color: "var(--text-tertiary)",
    fontStyle: "italic",
  },
};

function signalStyle(s_status: string): React.CSSProperties {
  switch (s_status) {
    case "verified":
      return { background: "#dcfce7", color: "var(--success)" };
    case "best_effort":
      return { background: "#fef9c3", color: "var(--warning)" };
    default:
      return { background: "var(--bg-panel-alt)", color: "var(--text-tertiary)" };
  }
}

function formatN(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return n.toLocaleString();
}

function formatCost(n: number | null | undefined): string {
  if (n == null) return "n/a";
  return `$${n.toFixed(4)}`;
}

interface TokenUsagePanelProps {
  telemetry: TelemetrySnapshot | null;
}

export function TokenUsagePanel({ telemetry }: TokenUsagePanelProps) {
  return (
    <div style={s.container}>
      <div style={s.sectionTitle}>Token Usage</div>
      {!telemetry ? (
        <p style={s.unavailable}>No telemetry data. Run konductor sync first.</p>
      ) : (
        <div style={s.card}>
          <div style={s.grid}>
            {(
              [
                { label: "Input", value: formatN(telemetry.input_tokens), key: "input_tokens" },
                { label: "Output", value: formatN(telemetry.output_tokens), key: "output_tokens" },
                { label: "Cache Read", value: formatN(telemetry.cache_read_tokens), key: "cache_read_tokens" },
                { label: "Cache Write", value: formatN(telemetry.cache_write_tokens), key: "cache_write_tokens" },
                { label: "Requests", value: formatN(telemetry.request_count), key: "request_count" },
                { label: "Cost", value: formatCost(telemetry.cost_usd), key: "cost_usd" },
              ] as const
            )
              .filter(({ key }) => (telemetry.signal_availability[key] ?? "unavailable") !== "unavailable")
              .map(({ label, value, key }) => (
              <div key={key} style={s.metric}>
                <span style={s.label}>{label}</span>
                <span style={s.value}>{value}</span>
                <span style={{ ...s.signal, ...signalStyle(telemetry.signal_availability[key] ?? "unavailable") }}>
                  {telemetry.signal_availability[key] ?? "unavailable"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
