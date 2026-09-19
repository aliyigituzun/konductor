import { useEffect, useMemo, useState } from "react";
import type { LaunchContextOption } from "./LaunchContextField.js";
import "./Agents.css";

interface ContextPickerFieldProps {
  label: string;
  addLabel: string;
  searchLabel: string;
  options: LaunchContextOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Multi-select companion to the prompt-pack field: chips for the chosen options
 * and an "Add" button that opens a searchable checklist. Used wherever a form
 * links several features or assets.
 */
export function ContextPickerField({ label, addLabel, searchLabel, options, selected, onChange }: ContextPickerFieldProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = selected
    .map((id) => options.find((option) => option.id === id))
    .filter((option): option is LaunchContextOption => Boolean(option));
  // Selected options float to the top; within each group the given order is kept.
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const matches = !term ? options : options.filter((option) => `${option.title} ${option.detail ?? ""}`.toLocaleLowerCase().includes(term));
    return [...matches.filter((option) => selected.includes(option.id)), ...matches.filter((option) => !selected.includes(option.id))];
  }, [options, query, selected]);

  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [open]);

  if (options.length === 0) return null;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  return (
    <div className="k-field">
      <span className="k-label">{label}</span>
      <div className="packs__chips">
        {chosen.map((option) => (
          <span key={option.id} className="packs__chip" title={option.title}>
            <span className="packs__chip-title">{option.title}</span>
            <button type="button" className="packs__chip-remove" aria-label={`Remove ${option.title}`} onClick={() => toggle(option.id)}>×</button>
          </span>
        ))}
        <button type="button" className="k-btn k-btn--sm" onClick={() => setOpen(true)}>{chosen.length === 0 ? addLabel : "Add"}</button>
      </div>
      {open ? (
        <div className="k-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={label} className="k-dialog packs__dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="k-dialog__header">
              <span>{label}</span>
              <span className="k-section__count">{selected.length}/{options.length}</span>
              <span className="k-spacer" />
              {selected.length > 0 ? <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => onChange([])}>Clear</button> : null}
              <button type="button" aria-label="Close" className="k-dialog__close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="packs__search">
              <input className="k-input" placeholder={searchLabel} aria-label={searchLabel} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="k-dialog__body packs__body">
              {visible.length === 0 ? (
                <p className="k-empty" style={{ padding: "10px 16px" }}>No matches.</p>
              ) : (
                visible.map((option) => {
                  const checked = selected.includes(option.id);
                  return (
                    <label key={option.id} className={`k-row packs__row${checked ? " k-row--active" : ""}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggle(option.id)} />
                      <span className="k-row__main" style={{ display: "grid", gap: 2 }}>
                        <strong className="k-truncate">{option.title}</strong>
                        {option.detail ? <span className="k-card__meta packs__excerpt">{option.detail}</span> : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="packs__footer">
              <span className="k-note">{selected.length === 0 ? "None selected" : `${selected.length} selected`}</span>
              <span className="k-spacer" />
              <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={() => setOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
