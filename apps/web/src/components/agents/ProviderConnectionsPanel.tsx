import type { AdapterInfo } from "../../lib/registry.js";
import type { ProviderConnection } from "../../lib/types.js";

export type ProviderConnectionDraft = {
  title: string;
  endpoint: string;
  kind: "remote_api" | "local_endpoint";
  provider: string;
  compatibleAdapters: string[];
  authEnv: string;
  apiKey: string;
};

export function defaultProviderConnectionDraft(): ProviderConnectionDraft {
  return { title: "", endpoint: "", kind: "remote_api", provider: "", compatibleAdapters: [], authEnv: "", apiKey: "" };
}

interface Props {
  connections: ProviderConnection[];
  adapters: AdapterInfo[];
  draft: ProviderConnectionDraft;
  onDraftChange: (draft: ProviderConnectionDraft) => void;
  onAdd: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}

/** Connections are configuration records, not a claim that every harness can use an API. */
export function ProviderConnectionsPanel({ connections, adapters, draft, onDraftChange, onAdd, onToggle, onDelete, busy }: Props) {
  const update = (patch: Partial<ProviderConnectionDraft>) => onDraftChange({ ...draft, ...patch });
  const toggleAdapter = (id: string) => update({
    compatibleAdapters: draft.compatibleAdapters.includes(id)
      ? draft.compatibleAdapters.filter((item) => item !== id)
      : [...draft.compatibleAdapters, id],
  });
  return <div className="cfg">
    <section className="k-section">
      <div className="k-section__header">Provider connections<span className="k-section__count">{connections.length}</span></div>
      <div className="k-section__body k-section__body--flush">
        {connections.length === 0 ? <p className="k-empty" style={{ padding: 10 }}>No provider connections yet.</p> : connections.map((connection) => (
          <div className="k-row" key={connection.id}>
            <span className="k-row__main"><strong>{connection.title}</strong><span className="k-row__meta" style={{ marginLeft: 8 }}>{connection.endpoint} · {connection.compatible_adapters.length} compatible harness{connection.compatible_adapters.length === 1 ? "" : "es"}</span></span>
            {!connection.enabled ? <span className="k-tag">disabled</span> : null}
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={busy} onClick={() => onToggle(connection.id)}>{connection.enabled ? "Disable" : "Enable"}</button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => onDelete(connection.id)}>Remove</button>
          </div>
        ))}</div>
      </section>
      <section className="k-section">
        <div className="k-section__header">Add provider connection</div>
        <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
          <p className="k-note" style={{ margin: 0 }}>Register a remote API or a service already running on this machine. API keys are referenced by environment-variable name and are never saved here.</p>
          <div className="k-field-grid">
            <div className="k-field"><label className="k-label" htmlFor="provider-title">Name</label><input id="provider-title" className="k-input" value={draft.title} placeholder="Local Ollama" onChange={(event) => update({ title: event.target.value })} /></div>
            <div className="k-field"><label className="k-label" htmlFor="provider-kind">Connection</label><select id="provider-kind" className="k-select" value={draft.kind} onChange={(event) => update({ kind: event.target.value as ProviderConnectionDraft["kind"] })}><option value="remote_api">Remote API</option><option value="local_endpoint">Existing local service</option></select></div>
            <div className="k-field"><label className="k-label" htmlFor="provider-endpoint">Base URL</label><input id="provider-endpoint" className="k-input" value={draft.endpoint} placeholder={draft.kind === "local_endpoint" ? "http://127.0.0.1:11434" : "https://api.example.com/v1"} onChange={(event) => update({ endpoint: event.target.value })} /></div>
            <div className="k-field"><label className="k-label" htmlFor="provider-id">Harness provider ID</label><input id="provider-id" className="k-input" value={draft.provider} placeholder="ollama" onChange={(event) => update({ provider: event.target.value })} /><span className="k-note">Must match the provider ID the selected harness accepts.</span></div>
            <div className="k-field"><label className="k-label" htmlFor="provider-key">API key</label><input id="provider-key" className="k-input" type="password" autoComplete="new-password" value={draft.apiKey} placeholder="Paste a key for this Konductor instance" onChange={(event) => update({ apiKey: event.target.value, authEnv: "" })} /><span className="k-note">Saved only in host-protected storage; it is never written to project configuration.</span></div>
            <div className="k-field"><label className="k-label" htmlFor="provider-auth">Or use an existing API-key environment variable</label><input id="provider-auth" className="k-input" disabled={Boolean(draft.apiKey)} value={draft.authEnv} placeholder="OLLAMA_API_KEY (optional)" onChange={(event) => update({ authEnv: event.target.value })} /></div>
          </div>
          <fieldset className="k-checks"><legend className="k-label">Compatible harnesses</legend>{adapters.map((adapter) => {
            const providerEntered = Boolean(draft.provider.trim());
            const supported = adapter.providers.some((provider) => provider.id === draft.provider.trim());
            return <label className="k-check" key={adapter.id} title={providerEntered && !supported ? "This harness does not declare the entered provider ID; save will explain the mismatch." : undefined}><input type="checkbox" checked={draft.compatibleAdapters.includes(adapter.id)} onChange={() => toggleAdapter(adapter.id)} />{adapter.title}<span className="k-faint">({adapter.providers.map((provider) => provider.id).join(", ")})</span></label>;
          })}</fieldset>
          <div className="k-actions"><button type="button" className="k-btn k-btn--primary" disabled={busy || !draft.title.trim() || !draft.endpoint.trim() || !draft.provider.trim()} onClick={onAdd}>Save provider connection</button></div>
        </div>
      </section>
    </div>;
}
