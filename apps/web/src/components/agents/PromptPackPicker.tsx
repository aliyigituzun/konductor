import { useEffect, useMemo, useState } from "react";
import type { PromptPack } from "../../lib/types.js";
import { filterPromptPacks } from "./helpers.js";

interface PromptPackPickerProps {
  packs: PromptPack[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}

/** Searchable multi-select over the project's prompt packs; edits apply as you toggle. */
export function PromptPackPicker({ packs, selected, onChange, onClose }: PromptPackPickerProps) {
  const [query, setQuery] = useState("");
  // Selected packs float to the top; within each group the registry order is kept.
  const visible = useMemo(() => {
    const matches = filterPromptPacks(packs, query);
    return [
      ...matches.filter((pack) => selected.includes(pack.id)),
      ...matches.filter((pack) => !selected.includes(pack.id)),
    ];
  }, [packs, query, selected]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-pack-picker-title"
        className="k-dialog packs__dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="k-dialog__header">
          <span id="prompt-pack-picker-title">Prompt packs</span>
          <span className="k-section__count">{selected.length}/{packs.length}</span>
          <span className="k-spacer" />
          {selected.length > 0 ? (
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => onChange([])}>Clear</button>
          ) : null}
          <button type="button" aria-label="Close" className="k-dialog__close" onClick={onClose}>×</button>
        </div>
        <div className="packs__search">
          <input
            className="k-input"
            placeholder="Search packs"
            aria-label="Search prompt packs"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="k-dialog__body packs__body">
          {visible.length === 0 ? (
            <p className="k-empty" style={{ padding: "10px 16px" }}>No packs match “{query.trim()}”.</p>
          ) : (
            visible.map((pack) => {
              const checked = selected.includes(pack.id);
              return (
                <label key={pack.id} className={`k-row packs__row${checked ? " k-row--active" : ""}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(pack.id)} />
                  <span className="k-row__main" style={{ display: "grid", gap: 2 }}>
                    <strong className="k-truncate">{pack.title}</strong>
                    <span className="k-card__meta packs__excerpt">{pack.instructions}</span>
                  </span>
                  {pack.file_refs.length > 0 ? (
                    <span className="k-row__meta">{pack.file_refs.length} file{pack.file_refs.length === 1 ? "" : "s"}</span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>
        <div className="packs__footer">
          <span className="k-note">{selected.length === 0 ? "No packs selected" : `${selected.length} selected`}</span>
          <span className="k-spacer" />
          <button type="button" className="k-btn k-btn--primary k-btn--sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
