import type { PromptPack } from "../../lib/types.js";
import type { PromptPackDraft } from "./helpers.js";

interface PromptPacksPanelProps {
  promptPacks: PromptPack[];
  draft: PromptPackDraft;
  onDraftChange: (draft: PromptPackDraft) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

/**
 * Prompt packs: the standing instructions prepended to every task an agent is given.
 *
 * They are what make a launched agent behave like a Konductor agent — reporting
 * progress through MCP — rather than a bare CLI session.
 */
export function PromptPacksPanel({
  promptPacks,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
  busy,
}: PromptPacksPanelProps) {
  const update = (patch: Partial<PromptPackDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <div className="cfg">
      <section className="k-section">
        <div className="k-section__header">Prompt packs<span className="k-section__count">{promptPacks.length}</span></div>
        <div className="k-section__body k-section__body--flush">
          {promptPacks.length === 0 ? (
            <p className="k-empty" style={{ padding: 10 }}>None</p>
          ) : (
            promptPacks.map((pack) => (
              <div key={pack.id} className="k-card" style={{ border: "none", borderBottom: "1px solid var(--border-subtle)", borderRadius: 0 }}>
                <div className="k-card__head">
                  <span className="k-card__title">{pack.title}</span>
                  <button
                    type="button"
                    className="k-btn k-btn--ghost k-btn--sm k-btn--danger"
                    disabled={busy || promptPacks.length === 1}
                    onClick={() => onDelete(pack.id)}
                    title={promptPacks.length === 1 ? "A project needs at least one prompt pack" : undefined}
                  >
                    Remove
                  </button>
                </div>
                <p className="k-card__meta k-truncate" title={pack.instructions}>{pack.instructions}</p>
                {pack.file_refs.length > 0 ? (
                  <div className="k-tags">
                    {pack.file_refs.map((ref) => <span key={ref} className="k-tag k-mono">{ref}</span>)}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="k-section">
        <div className="k-section__header">New prompt pack</div>
        <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
          <div className="k-field">
            <label className="k-label" htmlFor="pack-title">Name</label>
            <input id="pack-title" className="k-input" value={draft.title} onChange={(event) => update({ title: event.target.value })} />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="pack-instructions">Instructions</label>
            <textarea id="pack-instructions" className="k-textarea" value={draft.instructions} onChange={(event) => update({ instructions: event.target.value })} />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="pack-refs">File references</label>
            <input id="pack-refs" className="k-input" placeholder="CLAUDE.md, docs/ARCHITECTURE.md" value={draft.file_refs} onChange={(event) => update({ file_refs: event.target.value })} />
          </div>
          <div className="k-actions">
            <button type="button" className="k-btn k-btn--primary" disabled={busy || !draft.title.trim() || !draft.instructions.trim()} onClick={onAdd}>Add prompt pack</button>
          </div>
        </div>
      </section>
    </div>
  );
}
