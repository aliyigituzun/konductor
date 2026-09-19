import { useEffect, useState } from "react";
import { relativeTime, runStatusColor } from "../../styles/ui.js";
import type { RunSummary } from "../../lib/types.js";
import { CopyButton } from "./CopyButton.js";
import { runToText, runsToText } from "./helpers.js";

interface RunListProps {
  title: string;
  runs: RunSummary[];
  /** History rows fold to one line and expand on click; running rows stay flat. */
  collapsible?: boolean;
}

/** A list of runs — used for both the running and the finished sets. */
export function RunList({ title, runs, collapsible = false }: RunListProps) {
  // Which run the full-screen dialog should open on; "" means the whole list.
  const [fullscreen, setFullscreen] = useState<string | null>(null);

  return (
    <section className="k-section">
      <div className="k-section__header">
        {title}<span className="k-section__count">{runs.length}</span>
        {collapsible && runs.length > 0 ? (
          <>
            <span className="k-spacer" />
            <CopyButton text={runsToText(runs)} />
            <FullscreenButton onClick={() => setFullscreen("")} label="Full screen history" />
          </>
        ) : null}
      </div>
      <div className="k-section__body k-section__body--flush">
        {runs.length === 0 ? (
          <p className="k-empty" style={{ padding: 10 }}>—</p>
        ) : collapsible ? (
          <RunRows runs={runs} onFullscreen={setFullscreen} />
        ) : (
          runs.map((run) => <FlatRunRow key={run.id} run={run} />)
        )}
      </div>
      {fullscreen !== null ? (
        <RunHistoryDialog title={title} runs={runs} focus={fullscreen} onClose={() => setFullscreen(null)} />
      ) : null}
    </section>
  );
}

function RunHeadline({ run }: { run: RunSummary }) {
  return (
    <span className="runs__headline">
      <strong className="k-truncate">{run.slug}</strong>
      <span className="k-pill" style={{ color: runStatusColor(run.status) }}>{run.status}</span>
      <span className="k-row__meta k-truncate">{run.adapter_id}{run.model ? ` · ${run.model}` : ""} · {relativeTime(run.started_at)}</span>
    </span>
  );
}

function FlatRunRow({ run }: { run: RunSummary }) {
  return (
    <div className="k-row runs__row">
      <span className="k-row__main" style={{ display: "grid", gap: 2 }}>
        <RunHeadline run={run} />
        <span className="k-card__meta k-truncate" title={run.prompt_excerpt}>{run.prompt_excerpt}</span>
        {run.last_error ? <span className="k-error runs__error">{run.last_error}</span> : null}
      </span>
    </div>
  );
}

interface RunRowsProps {
  runs: RunSummary[];
  /** Ids expanded on first render; used by the dialog to open on the focused run. */
  initialOpen?: string[];
  onFullscreen?: (id: string) => void;
}

function RunRows({ runs, initialOpen = [], onFullscreen }: RunRowsProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen));
  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      {runs.map((run) => {
        const expanded = open.has(run.id);
        return (
          <div key={run.id} data-run-id={run.id} className="k-row runs__row">
            <button
              type="button"
              className="runs__toggle"
              aria-expanded={expanded}
              onClick={() => toggle(run.id)}
            >
              <span className={`runs__chevron${expanded ? " runs__chevron--open" : ""}`} aria-hidden="true">▸</span>
              <span className="runs__summary">
                <RunHeadline run={run} />
                {!expanded ? (
                  <>
                    <span className="k-card__meta k-truncate" title={run.prompt_excerpt}>{run.prompt_excerpt}</span>
                    {run.last_error ? <span className="k-error k-truncate runs__error-line">{run.last_error}</span> : null}
                  </>
                ) : null}
              </span>
            </button>
            {expanded ? <RunDetail run={run} {...(onFullscreen ? { onFullscreen: () => onFullscreen(run.id) } : {})} /> : null}
          </div>
        );
      })}
    </>
  );
}

function RunDetail({ run, onFullscreen }: { run: RunSummary; onFullscreen?: () => void }) {
  return (
    <div className="runs__detail">
      <dl className="k-kv">
        <dt>profile</dt><dd>{run.profile_title}</dd>
        <dt>started</dt><dd className="k-mono">{run.started_at}</dd>
        {run.ended_at ? <><dt>ended</dt><dd className="k-mono">{run.ended_at}</dd></> : null}
        {run.exit_code !== null && run.exit_code !== undefined ? <><dt>exit code</dt><dd className="k-mono">{run.exit_code}</dd></> : null}
        {run.branch ? <><dt>branch</dt><dd className="k-mono">{run.branch}</dd></> : null}
        {run.feature_item_title || run.feature_item_id ? <><dt>item</dt><dd>{run.feature_item_title ?? run.feature_item_id}</dd></> : null}
        <dt>log</dt><dd className="k-mono">{run.log_path}</dd>
      </dl>
      {run.prompt_excerpt ? <pre className="runs__block">{run.prompt_excerpt}</pre> : null}
      {run.last_error ? <pre className="runs__block runs__block--error">{run.last_error}</pre> : null}
      <div className="k-actions">
        <CopyButton text={runToText(run)} className="k-btn k-btn--sm" />
        {onFullscreen ? <FullscreenButton onClick={onFullscreen} label="Open full screen" /> : null}
      </div>
    </div>
  );
}

function FullscreenButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--icon" aria-label={label} title={label} onClick={onClick}>
      ⤢
    </button>
  );
}

interface RunHistoryDialogProps {
  title: string;
  runs: RunSummary[];
  /** Run id to open expanded and scroll to; "" opens the plain list. */
  focus: string;
  onClose: () => void;
}

function RunHistoryDialog({ title, runs, focus, onClose }: RunHistoryDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!focus) return;
    document.querySelector(`.runs__dialog [data-run-id="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "start" });
  }, [focus]);

  return (
    <div className="k-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-history-title"
        className="k-dialog runs__dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="k-dialog__header">
          <span id="run-history-title">{title}</span>
          <span className="k-section__count">{runs.length}</span>
          <span className="k-spacer" />
          <CopyButton text={runsToText(runs)} />
          <button type="button" aria-label="Close" className="k-dialog__close" onClick={onClose}>×</button>
        </div>
        <div className="k-dialog__body">
          <RunRows runs={runs} initialOpen={focus ? [focus] : []} />
        </div>
      </div>
    </div>
  );
}
