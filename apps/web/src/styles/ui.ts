/** Colour for a live agent's status pill. */
export function agentStatusColor(status: string | null | undefined): string {
  switch (status) {
    case "working":
      return "var(--accent)";
    case "idle":
      return "var(--success)";
    case "blocked":
      return "var(--warning)";
    case "dead":
      return "var(--danger)";
    default:
      return "var(--text-tertiary)";
  }
}

/** Colour for a finished run's terminal status. */
export function runStatusColor(status: string): string {
  switch (status) {
    case "running":
    case "queued":
      return "var(--accent)";
    case "succeeded":
      return "var(--success)";
    case "failed":
      return "var(--danger)";
    case "stopped":
      return "var(--warning)";
    default:
      return "var(--text-tertiary)";
  }
}

/** Colour for a feature/phase item status. */
export function itemStatusColor(status: string): string {
  switch (status) {
    case "done":
      return "var(--success)";
    case "in_progress":
      return "var(--accent)";
    case "blocked":
      return "var(--danger)";
    default:
      return "var(--text-tertiary)";
  }
}

/** Monospace glyph for a feature/phase item status. */
export function itemStatusGlyph(status: string): string {
  switch (status) {
    case "done":
      return "✓";
    case "in_progress":
      return "▶";
    case "blocked":
      return "✗";
    default:
      return "·";
  }
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
