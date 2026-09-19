import { useEffect, useMemo, useRef, useState } from "react";
import { parseAnsiScreen, styleToCss } from "../../lib/ansi.js";
import { ApiError, readAgentScreen, type FleetAgent } from "../../lib/registry.js";
import { agentStatusColor } from "../../styles/ui.js";
import { CopyButton } from "./CopyButton.js";
import { fleetModelLabel } from "./FleetPanel.js";

/** How often the pane is re-read while the dialog is open. */
const SCREEN_POLL_MS = 1000;

interface TerminalDialogProps {
  /** The agent to show; null when it has left the fleet since the dialog opened. */
  agent: FleetAgent | null;
  slug: string;
  onSend: (slug: string, text: string) => Promise<void>;
  onStop: (slug: string) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}

/**
 * The agent's tmux pane, mirrored into the dashboard.
 *
 * This is a window onto the pane, not a terminal of its own: the screen is what
 * tmux reports, redrawn on a short poll, and input goes through the same send path
 * the CLI uses. Anything beyond typing a message — answering a menu with arrow
 * keys, say — is what the attach command above the screen is for.
 */
export function TerminalDialog({ agent, slug, onSend, onStop, onClose, busy }: TerminalDialogProps) {
  const [screen, setScreen] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { text } = await readAgentScreen(slug, { source: "visible", ansi: true });
        if (!cancelled) {
          setScreen(text);
          setGone(false);
        }
      } catch (error) {
        if (cancelled) return;
        // 404 means the agent left the fleet: the last screen stays up, marked as such.
        if (error instanceof ApiError && error.status === 404) setGone(true);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), SCREEN_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slug]);

  const lines = useMemo(() => (screen === null ? [] : parseAnsiScreen(screen)), [screen]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    await onSend(slug, text);
    setDraft("");
    inputRef.current?.focus();
  };

  const finished = gone || agent === null;

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terminal-dialog-title"
        className="k-dialog term"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="k-dialog__header">
          <span id="terminal-dialog-title" style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
            <strong>{slug}</strong>
            {agent ? (
              <>
                <span className="k-pill" style={{ color: agentStatusColor(agent.agent_status) }}>{agent.agent_status}</span>
                <span className="k-row__meta k-truncate">{agent.adapter_title} · {fleetModelLabel(agent)}</span>
              </>
            ) : (
              <span className="k-pill" style={{ color: "var(--text-tertiary)" }}>finished</span>
            )}
          </span>
          <span className="k-spacer" />
          {agent ? (
            <button type="button" className="k-btn k-btn--sm k-btn--danger" disabled={busy} onClick={() => void onStop(slug)}>Stop</button>
          ) : null}
          <button type="button" aria-label="Close" className="k-dialog__close" onClick={onClose}>×</button>
        </div>

        <div className="term__attach">
          {agent ? (
            <>
              <span className="fleet__attach-label">attach</span>
              <code className="fleet__attach-cmd">{agent.attach_command}</code>
              <CopyButton text={agent.attach_command} />
            </>
          ) : (
            <span className="k-faint">The tmux window is closed; there is nothing to attach to.</span>
          )}
        </div>

        <div className="term__screen" aria-live="off">
          {screen === null && !finished ? (
            <span className="k-faint">Reading pane…</span>
          ) : (
            <pre className="term__pre">
              {lines.map((spans, index) => (
                <div key={index} className="term__line">
                  {spans.length === 0
                    ? " "
                    : spans.map((span, spanIndex) => (
                        <span key={spanIndex} style={styleToCss(span.style)}>{span.text}</span>
                      ))}
                </div>
              ))}
            </pre>
          )}
        </div>

        <div className="term__input">
          {finished ? (
            <span className="k-faint">Finished</span>
          ) : (
            <>
              <input
                ref={inputRef}
                className="k-input k-mono"
                placeholder={agent?.agent_status === "blocked" ? "Answer the prompt…" : `Message ${slug}… (Enter sends)`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void send(); }}
                autoFocus
              />
              <button type="button" className="k-btn k-btn--primary" disabled={busy || !draft.trim()} onClick={() => void send()}>Send</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
