import { useState } from "react";
import "./ProjectProfileSwitcher.css";

export interface ProjectProfilePreview {
  id: string;
  name: string;
  color: string;
  projectIds: string[];
}

interface Props {
  activeProfileId: string;
  profiles: ProjectProfilePreview[];
  onSelect: (profileId: string) => void;
  onCreate: (name: string) => void;
  onConfigure: () => void;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
}

export function ProjectProfileSwitcher({ activeProfileId, profiles, onSelect, onCreate, onConfigure }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]!;

  function create() {
    const next = name.trim();
    if (!next) return;
    onCreate(next);
    setName("");
    setCreating(false);
    setOpen(false);
  }

  return (
    <div className="pps">
      {open && (
        <div className="pps__pop" role="dialog" aria-label="Profiles">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`pps__item${profile.id === activeProfileId ? " pps__item--active" : ""}`}
              onClick={() => { onSelect(profile.id); setOpen(false); }}
            >
              <span className="pps__dot" style={{ background: profile.color }}>{initials(profile.name)}</span>
              <span className="k-truncate" style={{ flex: 1 }}>{profile.name}</span>
              <span className="k-faint k-num">{profile.projectIds.length}</span>
            </button>
          ))}
          <div className="pps__sep" />
          <button type="button" className="pps__item" onClick={() => { onConfigure(); setOpen(false); }}>
            <span className="pps__settings" aria-hidden="true">⚙</span>
            Configure {active.name}
          </button>
          <div className="pps__sep" />
          {creating ? (
            <div style={{ display: "grid", gap: 6, padding: 2 }}>
              <input
                autoFocus
                className="k-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") create(); if (event.key === "Escape") setCreating(false); }}
                placeholder="Profile name"
              />
              <div className="k-actions" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="k-btn k-btn--sm" onClick={() => setCreating(false)}>Cancel</button>
                <button type="button" className="k-btn k-btn--sm k-btn--primary" onClick={create}>Create</button>
              </div>
            </div>
          ) : (
            <button type="button" className="pps__item" onClick={() => setCreating(true)}>+ New profile</button>
          )}
        </div>
      )}
      <button type="button" className="pps__trigger" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="pps__dot" style={{ background: active.color }}>{initials(active.name)}</span>
        <span className="k-truncate" style={{ flex: 1, fontWeight: 500 }}>{active.name}</span>
        <span className="k-faint" style={{ fontSize: 9 }}>{open ? "▼" : "▲"}</span>
      </button>
    </div>
  );
}
