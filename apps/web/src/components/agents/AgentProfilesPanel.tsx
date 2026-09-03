import { s } from "../../styles/ui.js";
import type { AdapterInfo } from "../../lib/registry.js";
import type { AgentProfile } from "../../lib/types.js";
import type { ProfileDraft } from "./helpers.js";

interface AgentProfilesPanelProps {
  profiles: AgentProfile[];
  defaultProfile: string;
  adapters: AdapterInfo[];
  draft: ProfileDraft;
  onDraftChange: (draft: ProfileDraft) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  busy: boolean;
}

/**
 * Agent profiles: a named pairing of an adapter with project-level overrides.
 *
 * Binary and model are deliberately blank by default — an empty override means
 * "use whatever the adapter manifest says", which is what most projects want.
 */
export function AgentProfilesPanel({
  profiles,
  defaultProfile,
  adapters,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
  onSetDefault,
  busy,
}: AgentProfilesPanelProps) {
  const update = (patch: Partial<ProfileDraft>) => onDraftChange({ ...draft, ...patch });
  const selectedAdapter = adapters.find((item) => item.id === draft.adapter) ?? null;

  return (
    <div style={s.panelCard}>
      <div>
        <div style={s.panelTitle}>Agent Profiles</div>
        <p style={s.panelText}>
          Each profile picks an agent and how to run it. Add a new adapter by dropping a
          manifest into <code>~/.konductor/adapters/</code>.
        </p>
      </div>

      <div style={s.itemList}>
        {profiles.length === 0 ? (
          <p style={s.empty}>No profiles yet.</p>
        ) : (
          profiles.map((profile) => {
            const adapter = adapters.find((item) => item.id === profile.adapter) ?? null;
            const isDefault = profile.id === defaultProfile;
            return (
              <article key={profile.id} style={s.itemCard}>
                <div style={s.itemHeader}>
                  <span style={s.itemTitle}>{profile.title}</span>
                  {isDefault ? <span style={s.tag}>default</span> : null}
                </div>
                <p style={s.itemMeta}>
                  {adapter ? adapter.title : `${profile.adapter} (not installed)`} ·{" "}
                  {profile.mode}
                  {profile.worktree ? " · own worktree" : ""}
                  {profile.model ? ` · ${profile.model}` : ""}
                </p>
                {adapter && !adapter.installed ? (
                  <p style={{ ...s.itemMeta, color: "var(--danger)" }}>
                    {adapter.binary} is not on PATH.
                  </p>
                ) : null}
                <div style={s.actionsRow}>
                  {!isDefault ? (
                    <button
                      type="button"
                      style={s.button}
                      disabled={busy}
                      onClick={() => onSetDefault(profile.id)}
                    >
                      Make default
                    </button>
                  ) : null}
                  <button
                    type="button"
                    style={s.dangerButton}
                    disabled={busy || profiles.length === 1}
                    onClick={() => onDelete(profile.id)}
                    title={
                      profiles.length === 1
                        ? "A project needs at least one profile."
                        : undefined
                    }
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div style={s.fieldGrid}>
          <div>
            <label style={s.label} htmlFor="profile-title">
              Title
            </label>
            <input
              id="profile-title"
              style={s.input}
              placeholder="Claude Code (worktree)"
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </div>
          <div>
            <label style={s.label} htmlFor="profile-adapter">
              Agent
            </label>
            <select
              id="profile-adapter"
              style={s.select}
              value={draft.adapter}
              onChange={(event) => update({ adapter: event.target.value })}
            >
              {adapters.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.title}
                  {adapter.installed ? "" : " (not installed)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={s.label} htmlFor="profile-mode">
              Mode
            </label>
            <select
              id="profile-mode"
              style={s.select}
              value={draft.mode}
              onChange={(event) =>
                update({ mode: event.target.value === "headless" ? "headless" : "pane" })
              }
            >
              <option value="pane">Pane (interactive)</option>
              <option value="headless">Headless (one-shot)</option>
            </select>
          </div>
          <div>
            <label style={s.label} htmlFor="profile-model">
              Model <span style={{ textTransform: "none" }}>(optional)</span>
            </label>
            <input
              id="profile-model"
              style={s.input}
              placeholder={selectedAdapter ? "adapter default" : ""}
              value={draft.model}
              onChange={(event) => update({ model: event.target.value })}
            />
          </div>
          <div>
            <label style={s.label} htmlFor="profile-binary">
              Binary <span style={{ textTransform: "none" }}>(optional)</span>
            </label>
            <input
              id="profile-binary"
              style={s.input}
              placeholder={selectedAdapter?.binary ?? ""}
              value={draft.binary}
              onChange={(event) => update({ binary: event.target.value })}
            />
          </div>
          <div>
            <label style={s.label} htmlFor="profile-args">
              Extra args <span style={{ textTransform: "none" }}>(optional)</span>
            </label>
            <input
              id="profile-args"
              style={s.input}
              placeholder="--verbose"
              value={draft.args}
              onChange={(event) => update({ args: event.target.value })}
            />
          </div>
        </div>

        <div style={s.checks}>
          <label style={s.checkRow}>
            <input
              type="checkbox"
              checked={draft.worktree}
              onChange={(event) => update({ worktree: event.target.checked })}
            />
            <span>Give each run its own git worktree</span>
          </label>
          <label style={s.checkRow}>
            <input
              type="checkbox"
              checked={draft.default_mcp}
              onChange={(event) => update({ default_mcp: event.target.checked })}
            />
            <span>
              Wire up Konductor MCP
              {selectedAdapter && selectedAdapter.mcp === "none" ? (
                <span style={{ ...s.helper, display: "block" }}>
                  {selectedAdapter.title} has no MCP support; this has no effect.
                </span>
              ) : null}
            </span>
          </label>
        </div>

        <div style={s.actionsRow}>
          <button
            type="button"
            style={s.button}
            disabled={busy || !draft.title.trim()}
            onClick={onAdd}
          >
            Add profile
          </button>
        </div>
      </div>
    </div>
  );
}
