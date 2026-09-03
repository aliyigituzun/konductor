import { s } from "../../styles/ui.js";
import type { AdapterInfo, HostHealth } from "../../lib/registry.js";
import type { AgentProfile, PromptPack } from "../../lib/types.js";

export interface LaunchDraft {
  profileId: string;
  slug: string;
  prompt: string;
  packIds: string[];
  worktree: boolean;
  headless: boolean;
}

interface LaunchAgentFormProps {
  profiles: AgentProfile[];
  promptPacks: PromptPack[];
  adapters: AdapterInfo[];
  hostHealth: HostHealth | null;
  draft: LaunchDraft;
  onChange: (draft: LaunchDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  message: string | null;
  error: string | null;
}

/**
 * The one place an agent gets launched.
 *
 * Preflight for the selected profile is shown before the button rather than after
 * the failure: a profile whose binary is missing, or a pane profile with no tmux,
 * cannot start, and saying so up front beats a 400 from the host.
 */
export function LaunchAgentForm({
  profiles,
  promptPacks,
  adapters,
  hostHealth,
  draft,
  onChange,
  onSubmit,
  submitting,
  message,
  error,
}: LaunchAgentFormProps) {
  const profile = profiles.find((item) => item.id === draft.profileId) ?? profiles[0] ?? null;
  const adapter = profile ? adapters.find((item) => item.id === profile.adapter) ?? null : null;
  const hostDown = hostHealth ? !hostHealth.running : false;

  const blocker = (() => {
    if (!profile) return "This project has no agent profiles yet. Add one below.";
    if (!adapter) {
      return `Profile "${profile.title}" uses adapter "${profile.adapter}", which is not installed.`;
    }
    if (!adapter.installed) {
      return `${adapter.title} is not on your PATH (looked for "${adapter.binary}").`;
    }
    if (hostDown) return "The Konductor host is not running. Start it with `konductor host start`.";
    return null;
  })();

  const update = (patch: Partial<LaunchDraft>) => onChange({ ...draft, ...patch });

  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>Launch Agent</div>
      <div style={{ ...s.sectionBody, display: "grid", gap: 12 }}>
        <div style={s.fieldGrid}>
          <div>
            <label style={s.label} htmlFor="launch-profile">
              Profile
            </label>
            <select
              id="launch-profile"
              style={s.select}
              value={profile?.id ?? ""}
              onChange={(event) => update({ profileId: event.target.value })}
            >
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} ({item.adapter} · {item.mode})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={s.label} htmlFor="launch-slug">
              Name <span style={{ textTransform: "none" }}>(optional)</span>
            </label>
            <input
              id="launch-slug"
              style={s.input}
              placeholder="e.g. login-fix"
              value={draft.slug}
              onChange={(event) => update({ slug: event.target.value })}
            />
          </div>
        </div>

        {promptPacks.length > 0 ? (
          <div>
            <span style={s.label}>Prompt packs</span>
            <div style={s.checks}>
              {promptPacks.map((pack) => (
                <label key={pack.id} style={s.checkRow}>
                  <input
                    type="checkbox"
                    checked={draft.packIds.includes(pack.id)}
                    onChange={(event) =>
                      update({
                        packIds: event.target.checked
                          ? [...draft.packIds, pack.id]
                          : draft.packIds.filter((id) => id !== pack.id),
                      })
                    }
                  />
                  <span>{pack.title}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <label style={s.label} htmlFor="launch-prompt">
            Task
          </label>
          <textarea
            id="launch-prompt"
            style={s.textarea}
            placeholder="Describe what this agent should do…"
            value={draft.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
          />
        </div>

        <div style={s.checks}>
          <label style={s.checkRow}>
            <input
              type="checkbox"
              checked={draft.worktree}
              onChange={(event) => update({ worktree: event.target.checked })}
            />
            <span>
              Own git worktree
              <span style={{ ...s.helper, display: "block" }}>
                Isolates this agent on its own branch so parallel agents never collide.
              </span>
            </span>
          </label>
          <label style={s.checkRow}>
            <input
              type="checkbox"
              checked={draft.headless}
              onChange={(event) => update({ headless: event.target.checked })}
            />
            <span>
              Run headless
              <span style={{ ...s.helper, display: "block" }}>
                One-shot, no pane. Faster for small well-specified tasks, but you cannot
                message it afterwards.
              </span>
            </span>
          </label>
        </div>

        {blocker ? (
          <div style={{ ...s.callout, borderColor: "var(--warning)", color: "var(--warning)" }}>
            <strong style={s.calloutTitle}>Cannot launch</strong>
            {blocker}
          </div>
        ) : adapter && !adapter.verified ? (
          <div style={{ ...s.callout, color: "var(--text-secondary)" }}>
            <strong style={s.calloutTitle}>Unverified adapter</strong>
            {adapter.title}&apos;s invocation flags have not been checked against the real
            CLI. It will run, but a wrong flag surfaces as a launch failure.
          </div>
        ) : null}

        {error ? <p style={s.error}>{error}</p> : null}
        {message ? <p style={s.helper}>{message}</p> : null}

        <div style={s.actionsRow}>
          <button
            type="button"
            style={s.primaryButton}
            disabled={submitting || !!blocker || !draft.prompt.trim()}
            onClick={onSubmit}
          >
            {submitting ? "Starting…" : "Start agent"}
          </button>
        </div>
      </div>
    </section>
  );
}
