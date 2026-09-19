import type { AdapterInfo } from "../../lib/registry.js";
import type { AgentProfile } from "../../lib/types.js";
import type { ProviderConnection } from "../../lib/types.js";
import type { ProfileDraft } from "./helpers.js";

interface AgentProfilesPanelProps {
  profiles: AgentProfile[];
  defaultProfile: string;
  adapters: AdapterInfo[];
  adaptersLoading: boolean;
  adaptersError: string | null;
  draft: ProfileDraft;
  onDraftChange: (draft: ProfileDraft) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  busy: boolean;
  providerConnections: ProviderConnection[];
}

/** Human summary of what a profile will run on, e.g. "Anthropic · Opus 5". */
export function describeModel(profile: AgentProfile, adapter: AdapterInfo | null): string {
  const provider =
    adapter?.providers.find((item) => item.id === profile.provider) ??
    (profile.provider ? null : adapter?.providers[0] ?? null);
  const providerLabel = provider?.title ?? profile.provider ?? "default provider";
  const model = provider?.models.find((item) => item.id === profile.model);
  const modelLabel = model?.title ?? profile.model ?? "default model";
  return `${providerLabel} · ${modelLabel}`;
}

/**
 * Agent profiles: a named pairing of a harness with a provider and model.
 *
 * The harness manifest decides what the pickers offer. A vendor CLI shows its one
 * provider read-only; a multi-provider harness lets the operator choose. Models are
 * suggestions, not a whitelist — a datalist keeps the field free-form so a model
 * newer than the catalog can still be named.
 */
export function AgentProfilesPanel({
  profiles,
  defaultProfile,
  adapters,
  adaptersLoading,
  adaptersError,
  draft,
  onDraftChange,
  onAdd,
  onDelete,
  onSetDefault,
  busy,
  providerConnections,
}: AgentProfilesPanelProps) {
  const update = (patch: Partial<ProfileDraft>) => onDraftChange({ ...draft, ...patch });
  const selectedAdapter = adapters.find((item) => item.id === draft.adapter) ?? null;
  const providers = selectedAdapter?.providers ?? [];
  const boundToOne = providers.length === 1;
  const selectedProvider =
    providers.find((item) => item.id === draft.provider) ?? providers[0] ?? null;
  const models = selectedProvider?.models ?? [];
  const compatibleConnections = providerConnections.filter((connection) =>
    connection.enabled && connection.provider === selectedProvider?.id && connection.compatible_adapters.includes(selectedAdapter?.id ?? ""),
  );

  const chooseAdapter = (adapterId: string) => {
    // A provider from the previous harness is meaningless here; fall back to the
    // new harness's own first provider and let the model be re-picked.
    const next = adapters.find((item) => item.id === adapterId) ?? null;
    update({ adapter: adapterId, provider: next?.providers[0]?.id ?? "", model: "" });
  };

  return (
    <div className="cfg">
      <section className="k-section">
        <div className="k-section__header">
          Profiles<span className="k-section__count">{profiles.length}</span>
        </div>
        <div className="k-section__body k-section__body--flush">
          {profiles.length === 0 ? (
            <p className="k-empty" style={{ padding: 10 }}>None</p>
          ) : (
            profiles.map((profile) => {
              const adapter = adapters.find((item) => item.id === profile.adapter) ?? null;
              const isDefault = profile.id === defaultProfile;
              const providerKnown =
                !adapter || !profile.provider || adapter.providers.some((item) => item.id === profile.provider);
              return (
                <div key={profile.id} className="k-row">
                  <span className="k-row__main">
                    <strong>{profile.title}</strong>
                    <span className="k-row__meta" style={{ marginLeft: 8 }}>
                      {adapter ? adapter.title : `${profile.adapter} (missing)`} · {describeModel(profile, adapter)}
                      {profile.worktree ? " · worktree" : ""}
                    </span>
                    {adapter && !adapter.installed ? <span className="k-row__meta" style={{ color: "var(--danger)", marginLeft: 8 }}>{adapter.binary} not on PATH</span> : null}
                    {!providerKnown ? <span className="k-row__meta" style={{ color: "var(--danger)", marginLeft: 8 }}>{adapter!.title} cannot use provider "{profile.provider}"</span> : null}
                  </span>
                  {isDefault ? <span className="k-tag k-tag--accent">default</span> : (
                    <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} onClick={() => onSetDefault(profile.id)}>Make default</button>
                  )}
                  <button
                    type="button"
                    className="k-btn k-btn--ghost k-btn--sm k-btn--danger"
                    disabled={busy || profiles.length === 1}
                    onClick={() => onDelete(profile.id)}
                    title={profiles.length === 1 ? "A project needs at least one profile" : undefined}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="k-section">
        <div className="k-section__header">New profile</div>
        <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
          {adaptersLoading ? <p className="k-note" style={{ margin: 0 }}>Loading harnesses…</p> : null}
          {!adaptersLoading && adapters.length === 0 ? (
            <div className="k-callout k-callout--warning">
              {adaptersError ? "Harnesses could not be loaded. Retry above." : "No agent harnesses are available."}
            </div>
          ) : null}
          <div className="k-field-grid">
            <div className="k-field">
              <label className="k-label" htmlFor="profile-title">Title</label>
              <input id="profile-title" className="k-input" placeholder="Claude Code (worktree)" value={draft.title} onChange={(event) => update({ title: event.target.value })} />
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-provider-connection">Provider connection</label>
              <select id="profile-provider-connection" className="k-select" value={draft.provider_connection_id} onChange={(event) => update({ provider_connection_id: event.target.value })}>
                <option value="">Use compatible connection automatically</option>
                {compatibleConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.title}</option>)}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-adapter">Harness</label>
              <select id="profile-adapter" className="k-select" value={draft.adapter} onChange={(event) => chooseAdapter(event.target.value)}>
                {adapters.map((adapter) => (
                  <option key={adapter.id} value={adapter.id}>{adapter.title}{adapter.installed ? "" : " (not installed)"}</option>
                ))}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-provider">Provider</label>
              {boundToOne ? (
                <div
                  className="k-input"
                  style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-panel)" }}
                  title={`${selectedAdapter?.title} only talks to ${providers[0]!.title}`}
                >
                  {providers[0]!.title}
                  <span className="k-faint">only</span>
                </div>
              ) : (
                <select
                  id="profile-provider"
                  className="k-select"
                  value={selectedProvider?.id ?? ""}
                  onChange={(event) => update({ provider: event.target.value, model: "" })}
                >
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.title}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-model">Model</label>
              <input
                id="profile-model"
                className="k-input"
                list="profile-model-options"
                placeholder={models.length > 0 ? "harness default — or pick one" : "harness default — or type a model id"}
                value={draft.model}
                onChange={(event) => update({ model: event.target.value })}
                autoComplete="off"
              />
              <datalist id="profile-model-options">
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.title ?? model.id}</option>
                ))}
              </datalist>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-binary">Binary</label>
              <input id="profile-binary" className="k-input" placeholder={selectedAdapter?.binary ?? ""} value={draft.binary} onChange={(event) => update({ binary: event.target.value })} />
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="profile-args">Extra args</label>
              <input id="profile-args" className="k-input" placeholder="--verbose" value={draft.args} onChange={(event) => update({ args: event.target.value })} />
            </div>
          </div>

          {selectedAdapter ? (
            <p className="k-note" style={{ margin: 0 }}>
              Launches <code>{selectedAdapter.launch}</code>
              {selectedAdapter.model_format === "provider/id" && selectedProvider && draft.model.trim()
                ? <> with <code>--model {selectedProvider.id}/{draft.model.trim()}</code></>
                : null}
              {!selectedAdapter.verified ? " · flags unverified against the real CLI" : null}
            </p>
          ) : null}

          <div className="k-checks">
            <label className="k-check">
              <input type="checkbox" checked={draft.worktree} onChange={(event) => update({ worktree: event.target.checked })} />
              Own git worktree per run
            </label>
            <label className="k-check" title={selectedAdapter && selectedAdapter.mcp === "none" ? `${selectedAdapter.title} has no MCP support` : undefined}>
              <input type="checkbox" checked={draft.default_mcp} onChange={(event) => update({ default_mcp: event.target.checked })} />
              Konductor MCP
              {selectedAdapter && selectedAdapter.mcp === "none" ? <span className="k-faint">(no effect)</span> : null}
            </label>
          </div>

          <div className="k-actions">
            <button type="button" className="k-btn k-btn--primary" disabled={busy || adaptersLoading || !draft.title.trim() || !selectedAdapter} onClick={onAdd}>Add profile</button>
          </div>
        </div>
      </section>
    </div>
  );
}
