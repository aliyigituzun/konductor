import { useEffect, useState } from "react";
import {
  fetchAssetWorkspace,
  formatApiError,
  saveAssetSettings,
  type AssetWorkspaceData,
} from "../../lib/registry.js";
import type { AgentProfile } from "../../lib/types.js";

interface AssetAccessPanelProps {
  projectId: string;
  profiles: AgentProfile[];
}

/** Which profiles receive asset context and may manage assets through MCP. */
export function AssetAccessPanel({ projectId, profiles }: AssetAccessPanelProps) {
  const [settings, setSettings] = useState<AssetWorkspaceData["settings"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError(null);
    void fetchAssetWorkspace(projectId)
      .then((data) => { if (!cancelled) setSettings(data.settings); })
      .catch((event) => { if (!cancelled) setError(formatApiError(event)); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!settings) return <p className={error ? "k-error" : "k-empty"}>{error ?? "…"}</p>;

  const toggleProfile = (profileId: string) => {
    setMessage(null);
    setSettings((current) => current ? {
      ...current,
      selected_profile_ids: current.selected_profile_ids.includes(profileId)
        ? current.selected_profile_ids.filter((id) => id !== profileId)
        : [...current.selected_profile_ids, profileId],
    } : current);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await saveAssetSettings(projectId, settings);
      setSettings(data.settings);
      setMessage("Saved");
    } catch (event) {
      setError(formatApiError(event));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cfg">
      <section className="k-section">
        <div className="k-section__header">Asset access</div>
        <div className="k-section__body" style={{ display: "grid", gap: 10 }}>
          <div className="k-field-grid">
            <div className="k-field">
              <span className="k-label">Profiles with asset access</span>
              <div className="k-checks">
                {profiles.length === 0 ? <p className="k-empty">No profiles</p> : profiles.map((profile) => (
                  <label key={profile.id} className="k-check">
                    <input type="checkbox" checked={settings.selected_profile_ids.includes(profile.id)} onChange={() => toggleProfile(profile.id)} />
                    {profile.title}
                  </label>
                ))}
              </div>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="asset-policy">Handoff policy</label>
              <select
                id="asset-policy"
                className="k-select"
                value={settings.review_policy}
                onChange={(event) => {
                  setMessage(null);
                  setSettings({ ...settings, review_policy: event.target.value === "wait_for_review" ? "wait_for_review" : "continue_after_handoff" });
                }}
              >
                <option value="continue_after_handoff">Hand off and continue</option>
                <option value="wait_for_review">Wait for review</option>
              </select>
            </div>
          </div>
          {error ? <p className="k-error">{error}</p> : null}
          <div className="k-actions">
            <button type="button" className="k-btn k-btn--primary" disabled={busy || settings.selected_profile_ids.length === 0} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </button>
            {message ? <span className="k-note">{message}</span> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
