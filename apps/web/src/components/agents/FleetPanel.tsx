import { useState } from "react";
import { agentStatusColor, pill, s } from "../../styles/ui.js";
import type { FleetAgent } from "../../lib/registry.js";

interface FleetPanelProps {
  agents: FleetAgent[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onSend: (slug: string, text: string) => Promise<void>;
  onStop: (slug: string) => Promise<void>;
  busy: boolean;
}

/**
 * The live fleet — the dashboard's face of `konductor agent list`.
 *
 * Each row is one agent the host is supervising right now, with the same send and
 * stop controls the CLI offers, so an operator does not have to switch to a terminal
 * to unblock one.
 */
export function FleetPanel({
  agents,
  selectedSlug,
  onSelect,
  onSend,
  onStop,
  busy,
}: FleetPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const send = async (slug: string) => {
    const text = (drafts[slug] ?? "").trim();
    if (!text) return;
    await onSend(slug, text);
    setDrafts((current) => ({ ...current, [slug]: "" }));
  };

  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>Live Agents</div>
      <div style={s.sectionBody}>
        {agents.length === 0 ? (
          <p style={s.empty}>
            No agents are running. Launch one above, or from the CLI with{" "}
            <code>konductor agent start</code>.
          </p>
        ) : (
          <div style={s.itemList}>
            {agents.map((agent) => {
              const selected = agent.slug === selectedSlug;
              const canSend = agent.transport === "tmux";
              return (
                <article
                  key={agent.slug}
                  style={{
                    ...s.itemCard,
                    borderColor: selected ? "#0284c7" : "var(--border-subtle)",
                  }}
                >
                  <div style={s.itemHeader}>
                    <button
                      type="button"
                      onClick={() => onSelect(agent.slug)}
                      style={{
                        ...s.itemTitle,
                        background: "none",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      {agent.slug}
                    </button>
                    <span style={pill(agentStatusColor(agent.agent_status))}>
                      {agent.agent_status}
                    </span>
                  </div>

                  <p style={s.itemMeta}>
                    {agent.adapter_title}
                    {agent.pane_id ? ` · pane ${agent.pane_id}` : " · headless"}
                    {agent.branch ? ` · ${agent.branch}` : ""}
                  </p>
                  <p style={s.itemMeta}>{agent.reason}</p>
                  {agent.feature_item_title ? (
                    <div style={s.tagRow}>
                      <span style={s.tag}>{agent.feature_item_title}</span>
                    </div>
                  ) : null}

                  {agent.agent_status === "blocked" ? (
                    <div
                      style={{
                        ...s.callout,
                        borderColor: "var(--warning)",
                        color: "var(--warning)",
                      }}
                    >
                      <strong style={s.calloutTitle}>Waiting on you</strong>
                      This agent has a prompt on screen. Answer it below, or take the pane
                      over with <code>konductor agent attach {agent.slug}</code>.
                    </div>
                  ) : null}

                  {canSend ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        style={{ ...s.input, flex: 1 }}
                        placeholder={`Message ${agent.slug}…`}
                        value={drafts[agent.slug] ?? ""}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [agent.slug]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void send(agent.slug);
                        }}
                      />
                      <button
                        type="button"
                        style={s.button}
                        disabled={busy || !(drafts[agent.slug] ?? "").trim()}
                        onClick={() => void send(agent.slug)}
                      >
                        Send
                      </button>
                      <button
                        type="button"
                        style={s.dangerButton}
                        disabled={busy}
                        onClick={() => void onStop(agent.slug)}
                      >
                        Stop
                      </button>
                    </div>
                  ) : (
                    <div style={s.actionsRow}>
                      <span style={s.helper}>
                        Headless agents run once and cannot be messaged.
                      </span>
                      <button
                        type="button"
                        style={s.dangerButton}
                        disabled={busy}
                        onClick={() => void onStop(agent.slug)}
                      >
                        Stop
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
