import { useEffect, useMemo, useState } from "react";

export interface LaunchContextOption { id: string; title: string; detail?: string; }
interface LaunchContextFieldProps { label: string; addLabel: string; searchLabel: string; options: LaunchContextOption[]; selected: string; onChange: (id: string) => void; }

/** Single-target companion to the prompt-pack picker for optional run context. */
export function LaunchContextField({ label, addLabel, searchLabel, options, selected, onChange }: LaunchContextFieldProps) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const chosen = options.find((option) => option.id === selected) ?? null;
  const visible = useMemo(() => { const term = query.trim().toLocaleLowerCase(); const matches = !term ? options : options.filter((option) => `${option.title} ${option.detail ?? ""}`.toLocaleLowerCase().includes(term)); return chosen ? [chosen, ...matches.filter((option) => option.id !== chosen.id)] : matches; }, [chosen, options, query]);
  useEffect(() => { if (!open) return; const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); }; window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown); }, [open]);
  if (options.length === 0) return null;
  return <div className="k-field"><span className="k-label">{label}</span><div className="packs__chips">
    {chosen ? <span className="packs__chip" title={chosen.title}><span className="packs__chip-title">{chosen.title}</span><button type="button" className="packs__chip-remove" aria-label={`Remove ${chosen.title}`} onClick={() => onChange("")}>×</button></span> : null}
    <button type="button" className="k-btn k-btn--sm" onClick={() => setOpen(true)}>{chosen ? "Change" : addLabel}</button>
  </div>{open ? <div className="k-backdrop" role="presentation" onMouseDown={() => setOpen(false)}><div role="dialog" aria-modal="true" aria-label={label} className="k-dialog packs__dialog" onMouseDown={(event) => event.stopPropagation()}>
    <div className="k-dialog__header"><span>{label}</span><span className="k-spacer" />{chosen ? <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => onChange("")}>Clear</button> : null}<button type="button" aria-label="Close" className="k-dialog__close" onClick={() => setOpen(false)}>×</button></div>
    <div className="packs__search"><input className="k-input" placeholder={searchLabel} aria-label={searchLabel} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="k-dialog__body packs__body">{visible.length === 0 ? <p className="k-empty" style={{ padding: "10px 16px" }}>No matches.</p> : visible.map((option) => { const active = option.id === selected; return <button key={option.id} type="button" className={`k-row packs__row packs__choice${active ? " k-row--active" : ""}`} onClick={() => { onChange(option.id); setOpen(false); }}><span className="k-row__main" style={{ display: "grid", gap: 2 }}><strong className="k-truncate">{option.title}</strong>{option.detail ? <span className="k-card__meta packs__excerpt">{option.detail}</span> : null}</span>{active ? <span className="k-row__meta">Selected</span> : null}</button>; })}</div>
  </div></div> : null}</div>;
}
