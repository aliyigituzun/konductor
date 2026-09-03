import { s } from "../../styles/ui.js";
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
    <div style={s.panelCard}>
      <div>
        <div style={s.panelTitle}>Prompt Packs</div>
        <p style={s.panelText}>
          Standing instructions prepended to every task. Referenced files are inlined at
          launch.
        </p>
      </div>

      <div style={s.itemList}>
        {promptPacks.length === 0 ? (
          <p style={s.empty}>No prompt packs yet.</p>
        ) : (
          promptPacks.map((pack) => (
            <article key={pack.id} style={s.itemCard}>
              <div style={s.itemHeader}>
                <span style={s.itemTitle}>{pack.title}</span>
                <button
                  type="button"
                  style={s.dangerButton}
                  disabled={busy || promptPacks.length === 1}
                  onClick={() => onDelete(pack.id)}
                  title={
                    promptPacks.length === 1
                      ? "A project needs at least one prompt pack."
                      : undefined
                  }
                >
                  Remove
                </button>
              </div>
              <p style={s.itemMeta}>{pack.instructions.slice(0, 220)}…</p>
              {pack.file_refs.length > 0 ? (
                <div style={s.tagRow}>
                  {pack.file_refs.map((ref) => (
                    <span key={ref} style={s.tag}>
                      {ref}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={s.label} htmlFor="pack-title">
            Title
          </label>
          <input
            id="pack-title"
            style={s.input}
            value={draft.title}
            onChange={(event) => update({ title: event.target.value })}
          />
        </div>
        <div>
          <label style={s.label} htmlFor="pack-instructions">
            Instructions
          </label>
          <textarea
            id="pack-instructions"
            style={s.textarea}
            value={draft.instructions}
            onChange={(event) => update({ instructions: event.target.value })}
          />
        </div>
        <div>
          <label style={s.label} htmlFor="pack-refs">
            File references <span style={{ textTransform: "none" }}>(one per line)</span>
          </label>
          <input
            id="pack-refs"
            style={s.input}
            placeholder="CLAUDE.md, docs/ARCHITECTURE.md"
            value={draft.file_refs}
            onChange={(event) => update({ file_refs: event.target.value })}
          />
        </div>
        <div style={s.actionsRow}>
          <button
            type="button"
            style={s.button}
            disabled={busy || !draft.title.trim() || !draft.instructions.trim()}
            onClick={onAdd}
          >
            Add prompt pack
          </button>
        </div>
      </div>
    </div>
  );
}
