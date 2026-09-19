import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useParams } from "react-router-dom";
import type { ChangeRequest, ReviewPointer } from "../lib/types.js";
import {
  fetchCustomerReview,
  formatApiError,
  previewBrowserUrl,
  submitChangeRequest,
  type CustomerReviewData,
} from "../lib/registry.js";
import "./CustomerReview.css";

/**
 * The customer's view of a preview instance: the running app in an iframe with
 * pointers placed over it. In direct mode the frame is cross-origin, so pointer
 * positions are relative to the visible frame; a same-origin (proxied) frame also
 * records scroll and document ratios.
 */

type Draft = Omit<ReviewPointer, "page_id">;

/** How often the page re-checks a preview that is still coming up. */
const STARTING_POLL_MS = 3000;

function frameMetrics(frame: HTMLIFrameElement | null): { scrollY: number; docHeight: number } | null {
  try {
    const win = frame?.contentWindow;
    const doc = win?.document;
    if (!win || !doc) return null;
    const docHeight = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, 1);
    return { scrollY: win.scrollY, docHeight };
  } catch {
    return null; // cross-origin frame
  }
}

export function CustomerReview() {
  const { token = "" } = useParams();
  const [data, setData] = useState<CustomerReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string>("");
  const [pinMode, setPinMode] = useState(true);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [summary, setSummary] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<ChangeRequest | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function load() {
      try {
        const next = await fetchCustomerReview(token);
        if (cancelled) return;
        setData(next);
        setError(null);
        setPageId((current) => current || next.session.pages[0]?.id || "");
        if (next.preview.status === "starting") timer = setTimeout(() => void load(), STARTING_POLL_MS);
      } catch (loadError) {
        if (!cancelled) setError(formatApiError(loadError));
      }
    }
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [token]);

  const pages = data?.session.pages ?? [];
  const page = pages.find((item) => item.id === pageId) ?? pages[0];
  const previewUrl = useMemo(
    () => (data && page ? previewBrowserUrl(data.preview, page.path) : null),
    [data, page],
  );
  const previewReady = data?.preview.status === "ready";
  const submittedForPage = useMemo(
    () => (data?.requests ?? []).filter((request) => request.page_id === page?.id).length,
    [data, page],
  );

  function addPointer(event: MouseEvent<HTMLDivElement>) {
    if (!pinMode || !wrap.current || !page) return;
    const rect = wrap.current.getBoundingClientRect();
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const yViewport = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const metrics = frameMetrics(frame.current);
    const yDocument = metrics
      ? Math.max(0, Math.min(1, (metrics.scrollY + yViewport * rect.height) / metrics.docHeight))
      : yViewport;
    setDrafts((current) => [...current, {
      id: crypto.randomUUID(),
      index: current.length + 1,
      x_ratio: xRatio,
      y_document_ratio: yDocument,
      viewport_width: Math.round(rect.width),
      viewport_height: Math.round(rect.height),
      scroll_y: metrics?.scrollY ?? 0,
      note: "",
    }]);
    setSent(null);
  }

  /** Pins stay where they were clicked relative to the frame; the app's own scroll is not tracked cross-origin. */
  function pinTop(pointer: Draft): string {
    const rect = wrap.current?.getBoundingClientRect();
    const metrics = frameMetrics(frame.current);
    if (metrics && rect) {
      const yPx = pointer.y_document_ratio * metrics.docHeight - metrics.scrollY;
      return `${Math.max(0, Math.min(100, (yPx / rect.height) * 100))}%`;
    }
    return `${pointer.y_document_ratio * 100}%`;
  }

  function switchPage(id: string) {
    setPageId(id);
    setDrafts([]);
    setSent(null);
  }

  async function submit() {
    if (!page) return;
    setSending(true);
    setSendError(null);
    try {
      const rect = wrap.current?.getBoundingClientRect();
      const created = await submitChangeRequest(token, {
        page_id: page.id,
        summary: summary.trim(),
        pointers: drafts.map((pointer) => ({ ...pointer, page_id: page.id })),
        viewport: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        submitted_by: name.trim() || null,
      });
      setSent(created);
      setDrafts([]);
      setSummary("");
      setData((current) => current ? { ...current, requests: [created, ...current.requests] } : current);
    } catch (submitError) {
      setSendError(formatApiError(submitError));
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <div className="cr">
        <div className="cr__top"><strong>Review</strong></div>
        <div className="cr__unavailable" style={{ position: "static" }}>
          <div className="k-callout k-callout--warning" style={{ whiteSpace: "pre-wrap", maxWidth: 480 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (!data || !page) {
    return <div className="cr"><div className="cr__top"><span className="k-loading">Loading review…</span></div><div /></div>;
  }

  return (
    <div className="cr">
      <div className="cr__top">
        <strong>{data.session.title}</strong>
        <span className="k-muted">{data.project_name}</span>
        <span className="k-spacer" />
        <span className="k-pill" style={{ color: previewReady ? "var(--success)" : "var(--warning)" }}>
          preview {data.preview.status}
        </span>
        <span className="k-faint">Customer</span>
      </div>
      <div className="cr__layout">
        <aside className="cr__side">
          <div>
            <div className="k-label" style={{ marginBottom: 4 }}>Pages</div>
            {pages.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`cr__page${item.id === page.id ? " cr__page--active" : ""}`}
                onClick={() => switchPage(item.id)}
              >
                {item.label}
                <span className="k-faint k-num">{data.requests.filter((request) => request.page_id === item.id).length}</span>
              </button>
            ))}
          </div>
          <dl className="k-kv">
            <dt>Path</dt><dd className="k-mono">{page.path}</dd>
            <dt>Sent</dt><dd className="k-num">{submittedForPage}</dd>
            <dt>Expires</dt><dd>{new Date(data.session.expires_at).toLocaleDateString()}</dd>
          </dl>
          {previewUrl && <a className="k-link" href={previewUrl} target="_blank" rel="noreferrer">Open in a new tab</a>}
        </aside>

        <main className="cr__main">
          <div className="k-toolbar" style={{ padding: "0 10px" }}>
            <button type="button" className={`k-btn k-btn--sm${pinMode ? " k-btn--primary" : ""}`} onClick={() => setPinMode((current) => !current)}>
              + Pointers
            </button>
            <button type="button" className="k-btn k-btn--sm" disabled={drafts.length === 0} onClick={() => setDrafts([])}>Clear</button>
            <span className="k-spacer" />
            <span className="k-faint">{pinMode ? "Click the page to place a pointer" : "Browse the page"}</span>
          </div>
          <div ref={wrap} className="cr__frame-wrap">
            {previewReady && previewUrl ? (
              <iframe ref={frame} className="cr__frame" src={previewUrl} title={`${page.label} preview`} />
            ) : (
              <div className="cr__unavailable">
                <div>
                  {data.preview.status === "starting"
                    ? "The preview is starting up. This page checks again in a few seconds."
                    : "The preview is not running. Ask the operator to restart it."}
                </div>
              </div>
            )}
            <div className={`cr__overlay${pinMode && previewReady ? " cr__overlay--pinning" : ""}`} onClick={addPointer}>
              {drafts.map((pointer) => (
                <button
                  key={pointer.id}
                  type="button"
                  className="cr__pin"
                  title={pointer.note || `Pointer ${pointer.index}`}
                  onClick={(event) => event.stopPropagation()}
                  style={{ left: `${pointer.x_ratio * 100}%`, top: pinTop(pointer) }}
                >
                  {pointer.index}
                </button>
              ))}
            </div>
          </div>
        </main>

        <aside className="cr__inspector">
          <div className="k-field">
            <label className="k-label" htmlFor="cr-summary">Change request</label>
            <textarea id="cr-summary" className="k-textarea" style={{ minHeight: 72 }} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="Describe the overall change…" />
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="cr-name">Your name (optional)</label>
            <input id="cr-name" className="k-input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="k-label">Pointers</span>
            <span className="k-section__count">{drafts.length}</span>
            <span className="k-spacer" />
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setPinMode(true)}>Add</button>
          </div>
          {drafts.length === 0 ? <p className="k-empty">None on this page</p> : drafts.map((pointer) => (
            <div key={pointer.id} className="cr__pointer">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="cr__pointer-id">{pointer.index}</span>
                <span className="k-faint k-num" style={{ fontSize: 11 }}>{Math.round(pointer.x_ratio * 100)}% · {Math.round(pointer.y_document_ratio * 100)}%</span>
                <span className="k-spacer" />
                <button
                  type="button"
                  className="k-btn k-btn--ghost k-btn--sm"
                  onClick={() => setDrafts((current) => current.filter((item) => item.id !== pointer.id).map((item, i) => ({ ...item, index: i + 1 })))}
                >
                  Remove
                </button>
              </div>
              <input
                className="k-input"
                value={pointer.note}
                onChange={(event) => setDrafts((current) => current.map((item) => item.id === pointer.id ? { ...item, note: event.target.value } : item))}
                placeholder="What should change here?"
              />
            </div>
          ))}
          {sendError && <div className="k-callout k-callout--danger" style={{ whiteSpace: "pre-wrap" }}>{sendError}</div>}
          <button
            type="button"
            className="k-btn k-btn--primary k-btn--block"
            disabled={sending || (!summary.trim() && drafts.length === 0)}
            onClick={() => void submit()}
          >
            {sending ? "Sending…" : "Submit"}
          </button>
          {sent && (
            <div className="k-callout k-callout--success">
              Sent with {sent.pointers.length} pointer{sent.pointers.length === 1 ? "" : "s"}. The team will see it in Konductor.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
