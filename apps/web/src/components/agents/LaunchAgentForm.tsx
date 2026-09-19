import type React from "react";
import type { AdapterInfo } from "../../lib/registry.js";
import type { AgentProfile, FeatureItem, PromptPack, TodoItem } from "../../lib/types.js";
import { describeModel } from "./AgentProfilesPanel.js";
import { PromptPackField } from "./PromptPackField.js";
import { LaunchContextField } from "./LaunchContextField.js";

export interface LaunchDraft {
  profileId: string;
  slug: string;
  prompt: string;
  packIds: string[];
  todoId: string;
  featureItemId: string;
}

interface LaunchAgentFormProps {
  profiles: AgentProfile[];
  promptPacks: PromptPack[];
  todos: TodoItem[];
  features: Array<FeatureItem & { categoryTitle: string }>;
  adapters: AdapterInfo[];
  draft: LaunchDraft;
  onChange: (draft: LaunchDraft) => void;
  onSubmit: () => void;
  submitting: boolean;
  settingUpAdapter: string | null;
  onSetupAdapter: (adapterId: string) => void;
  onOpenConfiguration: () => void;
  /** Rendered in the section header, next to the profiles shortcut. */
  status?: React.ReactNode;
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
  todos,
  features,
  adapters,
  draft,
  onChange,
  onSubmit,
  submitting,
  settingUpAdapter,
  onSetupAdapter,
  onOpenConfiguration,
  status,
}: LaunchAgentFormProps) {
  const profile = profiles.find((item) => item.id === draft.profileId) ?? profiles[0] ?? null;
  const adapter = profile ? adapters.find((item) => item.id === profile.adapter) ?? null : null;
  const blocker = (() => {
    if (!profile) return "No agent profiles configured.";
    if (!adapter) return `Adapter "${profile.adapter}" is not installed.`;
    if (!adapter.installed) return `${adapter.binary} is not on PATH.`;
    if (profile.default_mcp !== false && adapter.setup.supported && !adapter.setup.configured) {
      return `${adapter.title} needs isolated Konductor MCP setup before launch.`;
    }
    if (profile.provider && !adapter.providers.some((item) => item.id === profile.provider)) {
      return `${adapter.title} cannot use provider "${profile.provider}"; edit the profile.`;
    }
    return null;
  })();

  const update = (patch: Partial<LaunchDraft>) => onChange({ ...draft, ...patch });

  // Keep the draft's order but drop ids whose pack no longer exists.
  return (
    <section className="k-section">
      <div className="k-section__header">
        Launch
        {status}
        <span className="k-spacer" />
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={onOpenConfiguration}>Profiles</button>
      </div>
      <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
        <div className="k-field-grid">
          {profiles.length > 1 ? (
            <div className="k-field">
              <label className="k-label" htmlFor="launch-profile">Profile</label>
              <select id="launch-profile" className="k-select" value={profile?.id ?? ""} onChange={(event) => update({ profileId: event.target.value })}>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {describeModel(item, adapter)}{item.worktree ? " · worktree" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : profile ? (
            <div className="k-field">
              <span className="k-label">Profile</span>
              <div className="k-input" style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-panel)" }}>
                <strong>{profile.title}</strong>
                <span className="k-row__meta">{describeModel(profile, adapter)}{profile.worktree ? " · worktree" : ""}</span>
              </div>
            </div>
          ) : null}

          <div className="k-field">
            <label className="k-label" htmlFor="launch-slug">Name</label>
            <input id="launch-slug" className="k-input" placeholder="optional, e.g. login-fix" value={draft.slug} onChange={(event) => update({ slug: event.target.value })} />
          </div>
        </div>

        <PromptPackField packs={promptPacks} selected={draft.packIds} onChange={(packIds) => update({ packIds })} />

        <div className="k-field-grid">
          <LaunchContextField label="To-do" addLabel="Add to-do" searchLabel="Search to-dos" options={todos.map((todo) => ({ id: todo.id, title: todo.title, detail: `${todo.status}${todo.related_asset_ids.length ? ` · ${todo.related_asset_ids.length} asset${todo.related_asset_ids.length === 1 ? "" : "s"}` : ""}` }))} selected={draft.todoId} onChange={(todoId) => update({ todoId })} />
          <LaunchContextField label="Feature" addLabel="Add feature" searchLabel="Search features" options={features.map((feature) => ({ id: feature.id, title: feature.title, detail: `${feature.categoryTitle} · ${feature.status}` }))} selected={draft.featureItemId} onChange={(featureItemId) => update({ featureItemId })} />
        </div>
        {draft.todoId ? <p className="k-note" style={{ margin: 0 }}>The selected to-do’s linked features and assets will be included in the hand-off.</p> : null}

        <div className="k-field">
          <label className="k-label" htmlFor="launch-prompt">Task</label>
          <textarea
            id="launch-prompt"
            className="k-textarea"
            placeholder="What should this agent do?"
            value={draft.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
          />
        </div>

        {blocker ? <div className="k-callout k-callout--warning">{blocker}</div> : null}

        {adapter?.setup.supported && !adapter.setup.configured ? (
          <div className="k-actions">
            <button
              type="button"
              className="k-btn k-btn--ghost"
              disabled={submitting || settingUpAdapter !== null}
              onClick={() => onSetupAdapter(adapter.id)}
            >
              {settingUpAdapter === adapter.id ? "Setting up…" : `Set up ${adapter.title}`}
            </button>
            <span className="k-note">
              Uses an isolated Konductor-owned configuration
              {adapter.setup.runtime_package ? ` and can install ${adapter.setup.runtime_package}` : ""}
              {adapter.setup.mcp_package ? ` with ${adapter.setup.mcp_package}` : ""}.
            </span>
          </div>
        ) : adapter?.setup.configured ? (
          <p className="k-note" style={{ margin: 0 }}>
            Konductor MCP setup: <span style={{ color: "var(--success)" }}>ready</span>
          </p>
        ) : null}

        <div className="k-actions">
          <button
            type="button"
            className="k-btn k-btn--primary"
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
