import { useState } from "react";
import { agentStatusColor } from "../../styles/ui.js";
import type { FleetAgent } from "../../lib/registry.js";
import { CopyButton } from "./CopyButton.js";

interface FleetPanelProps {
  agents: FleetAgent[];
  onSend: (slug: string, text: string) => Promise<void>;
  onRespond: (slug: string, action: "accept" | "cancel") => Promise<void>;
  onStop: (slug: string) => Promise<void>;
  onOpenTerminal: (slug: string) => void;
  busy: boolean;
  /** Hide the project column when every agent belongs to the current project. */
  projectId?: string;
}

/** "Anthropic · claude-opus-5", or what is known of it. */
export function fleetModelLabel(agent: Pick<FleetAgent, "provider" | "model">): string {
  return [agent.provider, agent.model ?? "default model"].filter(Boolean).join(" · ");
}

/**
 * The live fleet — the dashboard's face of `konductor agent list`.
 *
 * Each row is one agent the host is supervising right now. Two ways in are offered
 * side by side: the tmux command to attach a real terminal, and a button that opens
 * the same screen inside the dashboard — so an operator can glance without leaving
 * the page and take over when a glance is not enough.
 */
export function FleetPanel({ agents, onSend, onRespond, onStop, onOpenTerminal, busy, projectId }: FleetPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const send = async (slug: string) => {
    const text = (drafts[slug] ?? "").trim();
    if (!text) return;
    await onSend(slug, text);
    setDrafts((current) => ({ ...current, [slug]: "" }));
  };

  return (
    <section className="k-section">
      <div className="k-section__header">Live agents<span className="k-section__count">{agents.length}</span></div>
      <div className="k-section__body k-section__body--flush">
        {agents.length === 0 ? (
          <p className="k-empty" style={{ padding: 10 }}>None running</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.slug} className="k-row fleet__row">
              <div className="fleet__body">
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{agent.slug}</strong>
                  <span className="k-pill" style={{ color: agentStatusColor(agent.agent_status) }}>{agent.agent_status}</span>
                  <span className="k-row__meta">
                    {agent.adapter_title} · {fleetModelLabel(agent)}
                    {agent.branch ? ` · ${agent.branch}` : ""}
                    {projectId && agent.project_id !== projectId ? ` · ${agent.project_id}` : ""}
                  </span>
                  {agent.feature_item_title ? <span className="k-tag k-tag--accent">{agent.feature_item_title}</span> : null}
                </div>
                {agent.reason ? <span className="k-card__meta">{agent.reason}</span> : null}
                <div className="fleet__attach">
                  <span className="fleet__attach-label">tmux</span>
                  <code className="fleet__attach-cmd">{agent.attach_command}</code>
                  <CopyButton text={agent.attach_command} label="Copy" />
                </div>
                <div className="fleet__send">
                  {agent.agent_status === "blocked" ? <>
                    <button type="button" className="k-btn" disabled={busy} onClick={() => void onRespond(agent.slug, "accept")}>Choose highlighted option</button>
                    <button type="button" className="k-btn k-btn--danger" disabled={busy} onClick={() => void onRespond(agent.slug, "cancel")}>Cancel dialog</button>
                  </> : null}
                  <input
                    className="k-input"
                    style={{ minHeight: 26 }}
                    placeholder={agent.agent_status === "blocked" ? "Answer the prompt…" : `Message ${agent.slug}…`}
                    value={drafts[agent.slug] ?? ""}
                    onChange={(event) => setDrafts((current) => ({ ...current, [agent.slug]: event.target.value }))}
                    onKeyDown={(event) => { if (event.key === "Enter") void send(agent.slug); }}
                  />
                  <button type="button" className="k-btn" disabled={busy || !(drafts[agent.slug] ?? "").trim()} onClick={() => void send(agent.slug)}>Send</button>
                </div>
              </div>
              <div className="fleet__actions">
                <button type="button" className="k-btn k-btn--sm" onClick={() => onOpenTerminal(agent.slug)}>Terminal</button>
                <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => void onStop(agent.slug)}>Stop</button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
