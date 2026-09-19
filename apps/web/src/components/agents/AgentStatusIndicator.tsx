import type { HostHealth } from "../../lib/registry.js";

interface AgentStatusIndicatorProps {
  activeAgents: number;
  hostHealth?: HostHealth | null;
  hasError?: boolean;
}

/** A compact project-level signal; it deliberately does not expose host internals. */
export function AgentStatusIndicator({
  activeAgents,
  hostHealth,
  hasError = false,
}: AgentStatusIndicatorProps) {
  const offline = hostHealth !== undefined && hostHealth !== null && !hostHealth.running;
  const error = hasError && !offline;
  const active = !error && !offline && activeAgents > 0;
  const color = error ? "var(--danger)" : offline ? "var(--warning)" : active ? "var(--success)" : "var(--text-tertiary)";
  const label = error ? "Error" : offline ? "Host offline" : active ? `${activeAgents} live` : "Idle";
  const title = hostHealth?.running ? `Host on :${hostHealth.port}` : hostHealth?.hint ?? hostHealth?.error ?? label;

  return (
    <span className={`k-status${active ? " k-status--live" : ""}`} title={title} aria-label={label} style={{ color }}>
      <span className="k-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
