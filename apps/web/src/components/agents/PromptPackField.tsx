import { useState } from "react";
import type { PromptPack } from "../../lib/types.js";
import { PromptPackPicker } from "./PromptPackPicker.js";
import "./Agents.css";

interface PromptPackFieldProps {
  packs: PromptPack[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

/** Selected packs as removable chips plus an "Add" button that opens the searchable picker. */
export function PromptPackField({ packs, selected, onChange }: PromptPackFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  if (packs.length === 0) return null;

  const selectedPacks = selected
    .map((id) => packs.find((pack) => pack.id === id))
    .filter((pack): pack is PromptPack => Boolean(pack));

  return (
    <div className="k-field">
      <span className="k-label">Prompt packs</span>
      <div className="packs__chips">
        {selectedPacks.map((pack) => (
          <span key={pack.id} className="packs__chip" title={pack.title}>
            <span className="packs__chip-title">{pack.title}</span>
            <button
              type="button"
              className="packs__chip-remove"
              aria-label={`Remove ${pack.title}`}
              onClick={() => onChange(selected.filter((id) => id !== pack.id))}
            >
              ×
            </button>
          </span>
        ))}
        <button type="button" className="k-btn k-btn--sm" onClick={() => setPickerOpen(true)}>
          {selectedPacks.length === 0 ? "Add prompt pack" : "Add"}
        </button>
      </div>
      {pickerOpen ? (
        <PromptPackPicker packs={packs} selected={selected} onChange={onChange} onClose={() => setPickerOpen(false)} />
      ) : null}
    </div>
  );
}
