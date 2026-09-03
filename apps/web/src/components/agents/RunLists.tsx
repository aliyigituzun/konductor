import { pill, runStatusColor, s } from "../../styles/ui.js";
import type { RunSummary } from "../../lib/types.js";

interface RunListProps {
  title: string;
  runs: RunSummary[];
  emptyText: string;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** A list of runs — used for both the running and the finished sets. */
export function RunList({ title, runs, emptyText, selectedRunId, onSelect }: RunListProps) {
  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>{title}</div>
      <div style={s.sectionBody}>
        {runs.length === 0 ? (
          <p style={s.empty}>{emptyText}</p>
        ) : (
          <div style={s.itemList}>
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelect(run.id)}
                style={{
                  ...s.runCard,
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: run.id === selectedRunId ? "#0284c7" : "var(--border-subtle)",
                }}
              >
                <div style={s.runHeader}>
                  <span style={s.itemTitle}>{run.slug}</span>
                  <span style={pill(runStatusColor(run.status))}>{run.status}</span>
                </div>
                <div style={s.itemMeta}>
                  {run.adapter_id} · {run.transport} · {formatWhen(run.started_at)}
                </div>
                <div style={s.itemMeta}>{run.prompt_excerpt}</div>
                {run.last_error ? (
                  <div style={{ ...s.itemMeta, color: "var(--danger)" }}>{run.last_error}</div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
