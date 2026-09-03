import React, { useState } from "react";
import type { UpdateEntry } from "../lib/types.js";

interface Props {
  updates: UpdateEntry[];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const s: Record<string, React.CSSProperties> = {
  root: { marginBottom: 24 },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  },
  toggle: {
    fontSize: 12,
    color: "var(--text-tertiary)",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: 0,
    textDecoration: "underline",
  },
  feed: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-soft)",
    overflow: "hidden",
  },
  dayGroup: { borderBottom: "1px solid var(--border-subtle)" },
  dayLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "var(--text-tertiary)",
    padding: "7px 14px",
    background: "var(--bg-panel)",
  },
  entry: {
    display: "flex",
    gap: 10,
    padding: "9px 14px",
    borderBottom: "1px solid var(--border-subtle)",
    alignItems: "flex-start",
  },
  entryLast: {
    display: "flex",
    gap: 10,
    padding: "9px 14px",
    alignItems: "flex-start",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    marginTop: 5,
    flexShrink: 0,
  },
  message: { fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, flex: 1 },
  milestoneMessage: {
    fontSize: 13,
    color: "var(--text-primary)",
    lineHeight: 1.5,
    flex: 1,
    fontWeight: 500,
  },
  meta: {
    fontSize: 11,
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap" as const,
    marginTop: 1,
  },
  phaseTag: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 5px",
    borderRadius: 3,
    background: "var(--bg-panel-alt)",
    color: "var(--text-tertiary)",
    marginLeft: 6,
    verticalAlign: "middle",
  },
  runTag: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 5px",
    borderRadius: 3,
    background: "rgba(2, 132, 199, 0.12)",
    color: "#0284c7",
    marginLeft: 6,
    verticalAlign: "middle",
  },
  empty: { fontSize: 13, color: "var(--text-tertiary)", padding: "14px", textAlign: "center" as const },
};

export function UpdatesFeed({ updates }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (updates.length === 0) {
    return (
      <div style={s.root}>
        <div style={s.header}>
          <div style={s.title}>Updates</div>
        </div>
        <div style={s.feed}>
          <div style={s.empty}>No updates yet — the agent will write updates here after each action.</div>
        </div>
      </div>
    );
  }

  const sorted = [...updates].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const visible = showAll ? sorted : sorted.slice(0, 20);

  // Group by day
  const groups: { label: string; entries: UpdateEntry[] }[] = [];
  for (const entry of visible) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return (
    <div style={s.root}>
      <div style={s.header}>
        <div style={s.title}>Updates</div>
        {updates.length > 20 && (
          <button style={s.toggle} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show recent" : `Show all ${updates.length}`}
          </button>
        )}
      </div>
      <div style={s.feed}>
        {groups.map((group, gi) => (
          <div key={group.label} style={gi < groups.length - 1 ? s.dayGroup : undefined}>
            <div style={s.dayLabel}>{group.label}</div>
            {group.entries.map((entry, ei) => {
              const isMilestone = entry.kind === "milestone";
              const isLast = ei === group.entries.length - 1 && gi === groups.length - 1;
              return (
                <div key={entry.id} style={isLast ? s.entryLast : s.entry}>
                  <div
                    style={{
                      ...s.dot,
                      background: isMilestone ? "#1f7a4d" : "var(--border-strong)",
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <span style={isMilestone ? s.milestoneMessage : s.message}>
                      {entry.message}
                    </span>
                    {entry.phase_id && (
                      <span style={s.phaseTag}>{entry.phase_id}</span>
                    )}
                    {entry.run_id && (
                      <span style={s.runTag}>
                        {entry.source ?? "run"} · {entry.run_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <div style={s.meta} title={entry.at}>
                    {relativeTime(entry.at)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
