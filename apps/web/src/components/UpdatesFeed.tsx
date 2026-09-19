import React, { useMemo, useState } from "react";
import type { UpdateAction, UpdateEntry, UpdateSubject } from "../lib/types.js";
import { relativeTime } from "../styles/ui.js";
import "./UpdatesFeed.css";

interface Props {
  updates: UpdateEntry[];
}

const RECENT = 20;

const SUBJECTS: { value: UpdateSubject; label: string }[] = [
  { value: "feature", label: "Feature" },
  { value: "todo", label: "To-do" },
  { value: "decision", label: "Decision" },
  { value: "agent", label: "Agent / task" },
  { value: "review", label: "Review" },
  { value: "preview", label: "Preview" },
];

const ACTIONS: { value: UpdateAction; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "edited", label: "Edited" },
  { value: "deleted", label: "Deleted" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
];

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Local calendar day of the entry as YYYY-MM-DD, comparable to <input type="date"> values.
function localDay(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function UpdatesFeed({ updates }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<UpdateSubject | "">("");
  const [action, setAction] = useState<UpdateAction | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtering = Boolean(query.trim() || subject || action || from || to);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return updates.filter((entry) => {
      if (subject && entry.subject !== subject) return false;
      if (action && entry.action !== action) return false;
      if (from || to) {
        const day = localDay(entry.at);
        if (from && day < from) return false;
        if (to && day > to) return false;
      }
      if (needle) {
        const haystack = [entry.message, entry.agent, entry.phase_id, entry.run_id, entry.feature_item_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [updates, query, subject, action, from, to]);

  const sorted = [...filtered].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const visible = showAll ? sorted : sorted.slice(0, RECENT);

  const groups: { label: string; entries: UpdateEntry[] }[] = [];
  for (const entry of visible) {
    const label = dayLabel(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.entries.push(entry);
    else groups.push({ label, entries: [entry] });
  }

  const clear = () => {
    setQuery("");
    setSubject("");
    setAction("");
    setFrom("");
    setTo("");
  };

  return (
    <details className="k-section" open>
      <summary className="k-section__header k-section__summary">
        <span className="k-chevron" aria-hidden="true">›</span>
        Updates
        <span className="k-section__count">{filtering ? `${filtered.length} / ${updates.length}` : updates.length}</span>
        <span className="k-spacer" />
        {sorted.length > RECENT && (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={(event) => { event.preventDefault(); setShowAll((v) => !v); }}>
            {showAll ? "Recent" : "All"}
          </button>
        )}
      </summary>
      {updates.length > 0 && (
        <div className="uf__filters">
          <input
            className="k-input uf__search"
            type="search"
            placeholder="Search updates"
            aria-label="Search updates"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="k-select" aria-label="Type" value={subject} onChange={(event) => setSubject(event.target.value as UpdateSubject | "")}>
            <option value="">Any type</option>
            {SUBJECTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <select className="k-select" aria-label="Action" value={action} onChange={(event) => setAction(event.target.value as UpdateAction | "")}>
            <option value="">Any action</option>
            {ACTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input className="k-input" type="date" aria-label="From date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
          <input className="k-input" type="date" aria-label="To date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
          {filtering && (
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={clear}>Clear</button>
          )}
        </div>
      )}
      {updates.length === 0 ? (
        <p className="k-empty" style={{ padding: 10 }}>No updates</p>
      ) : filtered.length === 0 ? (
        <p className="k-empty" style={{ padding: 10 }}>No matching updates</p>
      ) : (
        groups.map((group) => (
          <div key={group.label}>
            <div className="uf__day">{group.label}</div>
            {group.entries.map((entry) => {
              const entrySubject = entry.subject;
              const entryAction = entry.action;
              return (
                <div key={entry.id} className={`uf__entry${entry.kind === "milestone" ? " uf__entry--milestone" : ""}${entryAction ? ` uf__entry--${entryAction}` : ""}`}>
                  <span className="k-dot" />
                  <div className="uf__msg">
                    {entry.message}
                    {entrySubject && (
                      <span className="k-tag">
                        {SUBJECTS.find((option) => option.value === entrySubject)?.label ?? entrySubject}
                        {entryAction ? ` · ${entryAction}` : ""}
                      </span>
                    )}
                    {entry.phase_id && <span className="k-tag">{entry.phase_id}</span>}
                    {entry.run_id && <span className="k-tag k-tag--accent">{entry.source ?? "run"} {entry.run_id.slice(0, 8)}</span>}
                  </div>
                  <span className="uf__when" title={entry.at}>{relativeTime(entry.at)}</span>
                </div>
              );
            })}
          </div>
        ))
      )}
    </details>
  );
}
