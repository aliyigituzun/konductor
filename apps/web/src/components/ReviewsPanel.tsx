import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeRequest, ChangeRequestStatus, GitBranch, PreviewInstance, PreviewStatus } from "../lib/types.js";
import {
  createReviewSession,
  fetchPreviewScreen,
  fetchProjectBranches,
  fetchProjectReviews,
  formatApiError,
  previewBrowserUrl,
  revokeReviewSession,
  startPreview,
  stopPreview,
  updateChangeRequest,
  type ProjectReviews,
  type PublicReviewSession,
} from "../lib/registry.js";
import { relativeTime } from "../styles/ui.js";

/** Poll while a preview is still coming up; otherwise data changes only on operator actions. */
const PREVIEW_POLL_MS = 2000;
const STATUSES: ChangeRequestStatus[] = ["open", "acknowledged", "in_progress", "resolved", "closed"];

type Props = { projectId: string; refreshToken?: number };
type PageDraft = { label: string; path: string };

function previewColor(status: PreviewStatus): string {
  if (status === "ready") return "var(--success)";
  if (status === "starting") return "var(--warning)";
  if (status === "failed" || status === "dead") return "var(--danger)";
  return "var(--text-tertiary)";
}

function requestColor(status: ChangeRequestStatus): string {
  if (status === "open") return "var(--warning)";
  if (status === "resolved" || status === "closed") return "var(--text-tertiary)";
  return "var(--accent)";
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function isLive(preview: PreviewInstance): boolean {
  return preview.status === "starting" || preview.status === "ready";
}

export function ReviewsPanel({ projectId, refreshToken = 0 }: Props) {
  const [data, setData] = useState<ProjectReviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchProjectReviews(projectId));
      setError(null);
    } catch (loadError) {
      setError(formatApiError(loadError));
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const starting = data?.previews.some((preview) => preview.status === "starting") ?? false;
  useEffect(() => {
    if (!starting) return;
    const timer = setInterval(() => { void load(); }, PREVIEW_POLL_MS);
    return () => clearInterval(timer);
  }, [starting, load]);

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (actError) {
      setError(formatApiError(actError));
    } finally {
      setBusy(false);
    }
  }

  const previews = data?.previews ?? [];
  const sessions = data?.sessions ?? [];
  const requests = data?.requests ?? [];

  return (
    <>
      {error && <div className="k-callout k-callout--danger" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}

      <PreviewsSection
        projectId={projectId}
        previews={previews}
        busy={busy}
        onStart={(branch) => act(() => startPreview(projectId, branch))}
        onStop={(preview, removeWorktree) => act(() => stopPreview(projectId, preview.id, removeWorktree))}
      />

      <SessionsSection
        projectId={projectId}
        sessions={sessions}
        previews={previews}
        requests={requests}
        busy={busy}
        onCreate={(input) => createReviewSession(projectId, input).then((result) => { void load(); return result; })}
        onRevoke={(session) => act(() => revokeReviewSession(projectId, session.id))}
      />

      <RequestsSection
        requests={requests}
        sessions={sessions}
        busy={busy}
        onStatus={(request, status) => act(() => updateChangeRequest(projectId, request.id, status))}
      />
    </>
  );
}

// ---- previews ----------------------------------------------------------------

function PreviewsSection({ projectId, previews, busy, onStart, onStop }: {
  projectId: string;
  previews: PreviewInstance[];
  busy: boolean;
  onStart: (branch: string) => Promise<void>;
  onStop: (preview: PreviewInstance, removeWorktree: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [screen, setScreen] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranches(null);
    setBranchError(null);
    fetchProjectBranches(projectId)
      .then((list) => {
        setBranches(list);
        setBranch((current) => current || list.find((item) => item.current)?.name || list[0]?.name || "");
      })
      .catch((loadError) => setBranchError(formatApiError(loadError)));
  }, [open, projectId]);

  const live = previews.filter(isLive);
  const past = previews.filter((preview) => !isLive(preview)).slice(0, 8);

  async function showScreen(preview: PreviewInstance) {
    try {
      setScreen({ id: preview.id, text: await fetchPreviewScreen(projectId, preview.id) });
    } catch (screenError) {
      setScreen({ id: preview.id, text: formatApiError(screenError) });
    }
  }

  return (
    <section className="k-section">
      <div className="k-section__header">
        Preview instances
        <span className="k-section__count">{live.length}</span>
        <span className="k-spacer" />
        <button type="button" className="k-btn k-btn--sm k-btn--primary" onClick={() => setOpen((current) => !current)}>
          {open ? "Cancel" : "New preview"}
        </button>
      </div>

      {open && (
        <div className="k-section__body" style={{ display: "grid", gap: 12, borderBottom: "1px solid var(--border-subtle)" }}>
          <p className="k-note" style={{ margin: 0 }}>
            Runs this project's <span className="k-mono">preview.command</span> from <span className="k-mono">konductor.config.json</span> on
            the chosen branch, in its own worktree and tmux window, on the next free port from the preview range.
          </p>
          {branchError && <div className="k-callout k-callout--danger" style={{ whiteSpace: "pre-wrap" }}>{branchError}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <div className="k-field" style={{ minWidth: 260 }}>
              <label className="k-label" htmlFor="rv-branch">Branch</label>
              <select id="rv-branch" className="k-select" value={branch} onChange={(event) => setBranch(event.target.value)} disabled={!branches}>
                {!branches && <option value="">Loading…</option>}
                {branches?.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}{item.current ? " (current)" : ""}{item.remote ? " (remote)" : ""}{item.checked_out_at && !item.current ? " (checked out)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="k-btn k-btn--primary"
              disabled={busy || !branch}
              onClick={() => { void onStart(branch).then(() => setOpen(false)); }}
            >
              Start
            </button>
          </div>
        </div>
      )}

      {previews.length === 0 ? (
        <div className="k-section__body"><p className="k-empty">No previews yet</p></div>
      ) : (
        <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
          <table className="k-table">
            <thead>
              <tr><th>Branch</th><th className="k-num">Port</th><th>Status</th><th>Started</th><th>Checkout</th><th /></tr>
            </thead>
            <tbody>
              {[...live, ...past].map((preview) => {
                const url = previewBrowserUrl({ url: null, port: preview.port });
                return (
                  <tr key={preview.id}>
                    <td className="k-mono">{preview.branch}</td>
                    <td className="k-num k-mono">{preview.port}</td>
                    <td>
                      <span className="k-pill" style={{ color: previewColor(preview.status) }}>{preview.status}</span>
                      {preview.last_error && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm" title={preview.last_error} onClick={() => setScreen({ id: preview.id, text: preview.last_error ?? "" })}>
                          why
                        </button>
                      )}
                    </td>
                    <td className="k-muted" title={preview.created_at}>{relativeTime(preview.created_at)}</td>
                    <td className="k-muted k-truncate k-mono" style={{ maxWidth: 260 }} title={preview.worktree_path}>{preview.worktree_path}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isLive(preview) && url && (
                        <a className="k-btn k-btn--ghost k-btn--sm" href={url} target="_blank" rel="noreferrer">Open</a>
                      )}
                      {isLive(preview) && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => void showScreen(preview)}>Output</button>
                      )}
                      {isLive(preview) && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => void onStop(preview, false)}>Stop</button>
                      )}
                      {!isLive(preview) && preview.worktree_created && (
                        <button
                          type="button"
                          className="k-btn k-btn--ghost k-btn--sm"
                          disabled={busy}
                          title={`Remove ${preview.worktree_path}`}
                          onClick={() => { if (window.confirm(`Remove the worktree at ${preview.worktree_path}?`)) void onStop(preview, true); }}
                        >
                          Remove worktree
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {screen && (
        <div className="k-section__body" style={{ borderTop: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="k-label">Preview output</span>
            <span className="k-spacer" />
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setScreen(null)}>Close</button>
          </div>
          <pre className="k-code" style={{ margin: 0, maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>{screen.text || "(no output yet)"}</pre>
        </div>
      )}
    </section>
  );
}

// ---- review links ------------------------------------------------------------

function SessionsSection({ projectId, sessions, previews, requests, busy, onCreate, onRevoke }: {
  projectId: string;
  sessions: PublicReviewSession[];
  previews: PreviewInstance[];
  requests: ChangeRequest[];
  busy: boolean;
  onCreate: (input: { title: string; preview_instance_id: string | null; access: "direct" | "proxied"; pages: PageDraft[]; expires_in_days: number }) => Promise<{ token: string }>;
  onRevoke: (session: PublicReviewSession) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [access, setAccess] = useState<"direct" | "proxied">("direct");
  const [expires, setExpires] = useState(14);
  const [pages, setPages] = useState<PageDraft[]>([{ label: "Home", path: "/" }]);
  const [issued, setIssued] = useState<{ url: string; title: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const livePreviews = useMemo(() => previews.filter(isLive), [previews]);
  useEffect(() => {
    if (!previewId && livePreviews[0]) setPreviewId(livePreviews[0].id);
  }, [livePreviews, previewId]);

  const requestCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const request of requests) counts.set(request.review_session_id, (counts.get(request.review_session_id) ?? 0) + 1);
    return counts;
  }, [requests]);

  const valid = title.trim() && previewId && pages.length > 0 && pages.every((page) => page.label.trim() && page.path.startsWith("/"));

  async function submit() {
    setFormError(null);
    try {
      const result = await onCreate({
        title: title.trim(),
        preview_instance_id: previewId,
        access,
        pages: pages.map((page) => ({ label: page.label.trim(), path: page.path.trim() })),
        expires_in_days: expires,
      });
      setIssued({ url: `${window.location.origin}/review/${result.token}`, title: title.trim() });
      setCopied(false);
      setTitle("");
      setPages([{ label: "Home", path: "/" }]);
      setOpen(false);
    } catch (createError) {
      setFormError(formatApiError(createError));
    }
  }

  return (
    <section className="k-section">
      <div className="k-section__header">
        Review links
        <span className="k-section__count">{sessions.filter((session) => session.state === "active").length}</span>
        <span className="k-spacer" />
        <button
          type="button"
          className="k-btn k-btn--sm"
          disabled={livePreviews.length === 0}
          title={livePreviews.length === 0 ? "Start a preview first" : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Cancel" : "New review link"}
        </button>
      </div>

      {issued && (
        <div className="k-section__body" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="k-callout k-callout--success" style={{ display: "grid", gap: 6 }}>
            <strong>Link for "{issued.title}" — shown once.</strong>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code className="k-mono" style={{ overflowWrap: "anywhere" }}>{issued.url}</code>
              <button
                type="button"
                className="k-btn k-btn--sm"
                onClick={() => { void navigator.clipboard?.writeText(issued.url).then(() => setCopied(true)); }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <a className="k-btn k-btn--sm" href={issued.url} target="_blank" rel="noreferrer">Open</a>
              <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setIssued(null)}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="k-section__body" style={{ display: "grid", gap: 12, borderBottom: "1px solid var(--border-subtle)" }}>
          {formError && <div className="k-callout k-callout--danger" style={{ whiteSpace: "pre-wrap" }}>{formError}</div>}
          <div className="k-field-grid">
            <div className="k-field">
              <label className="k-label" htmlFor="rv-title">Title</label>
              <input id="rv-title" className="k-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Website refresh" />
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="rv-preview">Preview</label>
              <select id="rv-preview" className="k-select" value={previewId} onChange={(event) => setPreviewId(event.target.value)}>
                {livePreviews.map((preview) => (
                  <option key={preview.id} value={preview.id}>{preview.branch} · :{preview.port} · {preview.status}</option>
                ))}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="rv-expires">Expires in (days)</label>
              <input id="rv-expires" className="k-input" type="number" min={1} value={expires} onChange={(event) => setExpires(Math.max(1, Number(event.target.value) || 1))} />
            </div>
            <div className="k-field">
              <span className="k-label">Access</span>
              <div className="k-seg">
                <button type="button" className={`k-seg__btn${access === "direct" ? " k-seg__btn--active" : ""}`} onClick={() => setAccess("direct")}>Direct port</button>
                <button type="button" className={`k-seg__btn${access === "proxied" ? " k-seg__btn--active" : ""}`} onClick={() => setAccess("proxied")}>Host proxy</button>
              </div>
              <span className="k-note">
                {access === "direct"
                  ? "The customer's browser opens the preview port on this machine's hostname."
                  : "Served through /preview/<id>/ on the host port; apps with absolute asset URLs need their base set to that prefix."}
              </span>
            </div>
          </div>

          <div className="k-field">
            <span className="k-label">Pages</span>
            {pages.map((page, index) => (
              <div key={index} style={{ display: "flex", gap: 8 }}>
                <input className="k-input" value={page.label} placeholder="Label" onChange={(event) => setPages((current) => current.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} />
                <input className="k-input k-mono" value={page.path} placeholder="/path" onChange={(event) => setPages((current) => current.map((item, i) => i === index ? { ...item, path: event.target.value } : item))} />
                <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={pages.length === 1} onClick={() => setPages((current) => current.filter((_, i) => i !== index))}>Remove</button>
              </div>
            ))}
            <div>
              <button type="button" className="k-btn k-btn--sm" onClick={() => setPages((current) => [...current, { label: "", path: "/" }])}>Add page</button>
            </div>
          </div>

          <div>
            <button type="button" className="k-btn k-btn--primary" disabled={busy || !valid} onClick={() => void submit()}>Create link</button>
          </div>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="k-section__body"><p className="k-empty">No review links yet</p></div>
      ) : (
        <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
          <table className="k-table">
            <thead>
              <tr><th>Title</th><th>Preview</th><th>Pages</th><th className="k-num">Requests</th><th>Expires</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const preview = previews.find((item) => item.id === session.preview_instance_id);
                return (
                  <tr key={session.id}>
                    <td>{session.title}</td>
                    <td className="k-muted k-mono">{preview ? `${preview.branch} · :${preview.port}` : "—"}</td>
                    <td className="k-muted">{session.pages.map((page) => page.label).join(", ")}</td>
                    <td className="k-num k-muted">{requestCount.get(session.id) ?? 0}</td>
                    <td className="k-muted" title={session.expires_at}>{relativeTime(session.expires_at)}</td>
                    <td><span className="k-pill" style={{ color: session.state === "active" ? "var(--success)" : "var(--text-tertiary)" }}>{session.state}</span></td>
                    <td style={{ textAlign: "right" }}>
                      {session.state === "active" && (
                        <button type="button" className="k-btn k-btn--ghost k-btn--sm k-btn--danger" disabled={busy} onClick={() => void onRevoke(session)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- change requests ---------------------------------------------------------

function RequestsSection({ requests, sessions, busy, onStatus }: {
  requests: ChangeRequest[];
  sessions: PublicReviewSession[];
  busy: boolean;
  onStatus: (request: ChangeRequest, status: ChangeRequestStatus) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sessionTitle = (id: string) => sessions.find((session) => session.id === id)?.title ?? "—";
  const pageLabel = (request: ChangeRequest) =>
    sessions.find((session) => session.id === request.review_session_id)?.pages.find((page) => page.id === request.page_id)?.label ?? request.page_id;

  return (
    <section className="k-section">
      <div className="k-section__header">Change requests<span className="k-section__count">{requests.length}</span></div>
      {requests.length === 0 ? (
        <div className="k-section__body"><p className="k-empty">Nothing submitted yet</p></div>
      ) : (
        <div className="k-table-scroll" style={{ border: "none", borderRadius: 0 }}>
          <table className="k-table">
            <thead>
              <tr><th>Review</th><th>Page</th><th>Summary</th><th className="k-num">Pointers</th><th>When</th><th>Status</th></tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <Fragment key={request.id}>
                  <tr onClick={() => setExpanded((current) => current === request.id ? null : request.id)} style={{ cursor: "pointer" }}>
                    <td className="k-muted">{sessionTitle(request.review_session_id)}</td>
                    <td className="k-muted">{pageLabel(request)}</td>
                    <td>{request.summary || <span className="k-faint">Pointers only</span>}</td>
                    <td className="k-num k-muted">{request.pointers.length}</td>
                    <td className="k-muted" title={request.created_at}>{relativeTime(request.created_at)}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select
                        className="k-select"
                        style={{ color: requestColor(request.status), minWidth: 130 }}
                        value={request.status}
                        disabled={busy}
                        onChange={(event) => void onStatus(request, event.target.value as ChangeRequestStatus)}
                      >
                        {STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                      </select>
                    </td>
                  </tr>
                  {expanded === request.id && request.pointers.length > 0 && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--bg-panel)" }}>
                        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
                          {request.pointers.map((pointer) => (
                            <li key={pointer.id}>
                              <span className="k-faint k-num" style={{ marginRight: 8 }}>{Math.round(pointer.x_ratio * 100)}% · {Math.round(pointer.y_document_ratio * 100)}%</span>
                              {pointer.note || <span className="k-faint">No note</span>}
                            </li>
                          ))}
                        </ol>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
