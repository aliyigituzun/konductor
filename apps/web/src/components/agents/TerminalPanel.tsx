import { useEffect, useRef, useState } from "react";
import { pill, runStatusColor, s } from "../../styles/ui.js";
import { fetchRunTerminal, readAgentScreen } from "../../lib/registry.js";
import type { RunSummary } from "../../lib/types.js";

type StreamMessage =
  | { type: "snapshot"; run: RunSummary | null; log: string; screen: string | null }
  | { type: "screen"; screen: string }
  | { type: "chunk"; chunk: string }
  | { type: "agent_status"; agent_status: string; reason: string }
  | { type: "status"; status: string; exit_code?: number | null };

interface TerminalPanelProps {
  runs: RunSummary[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

/**
 * Live view of one agent.
 *
 * A pane agent's output is its screen, which is replaced wholesale on every redraw;
 * a headless agent's output is an append-only stream. The panel handles both, and
 * falls back to polling when the WebSocket cannot be reached — the dashboard being
 * useful matters more than the transport it used to get there.
 */
export function TerminalPanel({ runs, selectedRunId, onSelect }: TerminalPanelProps) {
  const [content, setContent] = useState("");
  const [live, setLive] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const run = runs.find((item) => item.id === selectedRunId) ?? null;
  const isPane = run?.transport === "tmux";

  useEffect(() => {
    if (!selectedRunId) {
      setContent("");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    // Whatever the transport, start from a snapshot so the panel is never blank.
    const loadSnapshot = async () => {
      try {
        if (isPane && run?.slug) {
          const { text } = await readAgentScreen(run.slug, { source: "visible" });
          if (!cancelled) setContent(text);
        } else {
          const { log } = await fetchRunTerminal(selectedRunId);
          if (!cancelled) setContent(log);
        }
      } catch {
        if (!cancelled) setContent("");
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      setLive(false);
      setNote("Live stream unavailable — polling every 2s.");
      pollTimer = setInterval(() => void loadSnapshot(), 2000);
    };

    void loadSnapshot();

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/hostws/runs/${selectedRunId}/stream`,
      );

      socket.onopen = () => {
        if (cancelled) return;
        setLive(true);
        setNote(null);
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let message: StreamMessage;
        try {
          message = JSON.parse(String(event.data)) as StreamMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case "snapshot":
            setContent(message.screen ?? message.log);
            break;
          case "screen":
            // A pane redraws its whole screen; replace rather than append.
            setContent(message.screen);
            break;
          case "chunk":
            setContent((current) => current + message.chunk);
            break;
          case "agent_status":
            setNote(`${message.agent_status} — ${message.reason}`);
            break;
          case "status":
            setNote(`Run ${message.status}.`);
            break;
        }
      };

      socket.onerror = () => startPolling();
      socket.onclose = () => {
        if (!cancelled) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      cancelled = true;
      socket?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [selectedRunId, isPane, run?.slug]);

  useEffect(() => {
    // Follow the tail of an append-only log; a pane screen has no tail to follow.
    if (!isPane && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [content, isPane]);

  return (
    <section style={s.section}>
      <div style={s.sectionHeader}>Terminal</div>
      <div style={s.sectionBody}>
        <div style={{ ...s.actionsRow, marginBottom: 10, alignItems: "center" }}>
          <select
            style={{ ...s.select, maxWidth: 320 }}
            value={selectedRunId ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Select a run…</option>
            {runs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.slug} · {item.status}
              </option>
            ))}
          </select>
          {run ? <span style={pill(runStatusColor(run.status))}>{run.status}</span> : null}
          {live ? <span style={s.helper}>live</span> : null}
        </div>

        {run ? (
          <p style={{ ...s.helper, marginBottom: 8 }}>
            {run.command}
            {run.pane_id ? ` · pane ${run.pane_id}` : ""}
          </p>
        ) : null}
        {note ? <p style={{ ...s.helper, marginBottom: 8 }}>{note}</p> : null}

        <div ref={bodyRef} style={s.terminal}>
          {content || "No output yet."}
        </div>
      </div>
    </section>
  );
}
