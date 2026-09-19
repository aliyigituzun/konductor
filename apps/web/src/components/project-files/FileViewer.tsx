import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, fetchProjectFileText, projectFileUrl } from "../../lib/registry.js";

type Kind = "markdown" | "image" | "pdf" | "text";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"]);

function kindOf(path: string): Kind {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "markdown";
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "text";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** A NUL in the first 8 KB is the usual heuristic for "this is not text". */
function looksBinary(text: string): boolean {
  return text.slice(0, 8192).includes(String.fromCharCode(0));
}

interface FileViewerProps {
  projectId: string;
  path: string | null;
}

export function FileViewer({ projectId, path }: FileViewerProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const kind = path ? kindOf(path) : null;
  const needsText = kind === "markdown" || kind === "text";

  useEffect(() => {
    setText(null);
    setError(null);
    setZoomed(false);
    if (!path || !needsText) return;
    let cancelled = false;
    setLoading(true);
    fetchProjectFileText(projectId, path)
      .then((body) => { if (!cancelled) setText(body); })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 413) setError("File too large to view");
        else setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, path, needsText]);

  if (!path || !kind) {
    return <div className="fv"><div className="fv__placeholder">Select a file</div></div>;
  }

  const rawUrl = projectFileUrl(projectId, path);
  const binary = text !== null && looksBinary(text);
  const size = text !== null ? formatBytes(new TextEncoder().encode(text).length) : null;
  const lines = text !== null && !binary ? text.split("\n") : null;
  if (lines && lines[lines.length - 1] === "") lines.pop();
  const lineCount = lines?.length ?? null;

  let body: React.ReactNode;
  if (error) {
    body = <div className="fv__placeholder">{error}</div>;
  } else if (kind === "image") {
    body = (
      <div className={`fv__image${zoomed ? " fv__image--full" : ""}`} onClick={() => setZoomed((z) => !z)}>
        <img src={rawUrl} alt={path} />
      </div>
    );
  } else if (kind === "pdf") {
    body = <iframe className="fv__pdf" src={rawUrl} title={path} />;
  } else if (loading || text === null) {
    body = <div className="fv__placeholder">…</div>;
  } else if (binary) {
    body = <div className="fv__placeholder">Binary file</div>;
  } else if (kind === "markdown") {
    body = (
      <div className="fv__prose">
        <div className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
    );
  } else {
    body = (
      <pre className="k-code">
        {(lines ?? []).map((line, i) => <div key={i} className="k-code__line">{line}</div>)}
      </pre>
    );
  }

  return (
    <div className="fv">
      <div className="fv__bar">
        <span className="fv__path" title={path}>{path}</span>
        {size ? <span className="k-faint k-num">{size}</span> : null}
        {kind === "text" && lineCount !== null ? <span className="k-faint k-num">{lineCount} lines</span> : null}
        <span className="k-spacer" />
        <a href={rawUrl} target="_blank" rel="noreferrer" className="k-link">raw</a>
      </div>
      <div className="fv__body">{body}</div>
    </div>
  );
}
