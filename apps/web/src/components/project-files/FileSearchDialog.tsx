import { useEffect, useRef, useState } from "react";
import { formatApiError, searchProjectFiles, type ProjectFileEntry } from "../../lib/registry.js";

interface FileSearchDialogProps {
  projectId: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "pdf"]);

function isDocument(path: string): boolean {
  return DOCUMENT_EXTENSIONS.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

function ResultGroup({ title, files, onSelect }: { title: string; files: ProjectFileEntry[]; onSelect: (path: string) => void }) {
  if (!files.length) return null;
  return (
    <section className="fs__group" aria-label={title}>
      <h3 className="fs__group-title">{title}</h3>
      {files.map((file) => (
        <button key={file.path} type="button" className="fs__result" onClick={() => onSelect(file.path)}>
          <span className="fs__result-name">{file.name}</span>
          <span className="fs__result-path">{file.path}</span>
        </button>
      ))}
    </section>
  );
}

/** Path search for the file explorer. Results are intentionally documents-first. */
export function FileSearchDialog({ projectId, onClose, onSelect }: FileSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setFiles([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void searchProjectFiles(projectId, trimmed)
        .then((nextFiles) => { if (!cancelled) setFiles(nextFiles); })
        .catch((nextError: unknown) => { if (!cancelled) setError(formatApiError(nextError)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [projectId, query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const documents = files.filter((file) => isDocument(file.path));
  const otherFiles = files.filter((file) => !isDocument(file.path));

  return (
    <div className="k-backdrop" onMouseDown={onClose}>
      <section className="k-dialog fs" role="dialog" aria-modal="true" aria-labelledby="file-search-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="k-dialog__header">
          <span id="file-search-title">Search project files</span>
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" onClick={onClose} aria-label="Close search">×</button>
        </header>
        <div className="fs__body">
          <label className="fs__input-wrap">
            <span className="fs__magnifier" aria-hidden="true">⌕</span>
            <input ref={inputRef} className="k-input fs__input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by file name or path" aria-label="Search project files" />
          </label>
          <div className="fs__results" aria-live="polite">
            {!query.trim() ? <p className="k-empty">Start typing to search this repository.</p> : null}
            {loading ? <p className="k-empty">Searching files…</p> : null}
            {error ? <p className="k-error">{error}</p> : null}
            {!loading && !error && query.trim() && !files.length ? <p className="k-empty">No files match “{query.trim()}”.</p> : null}
            {!loading && !error ? <>
              <ResultGroup title="Documents" files={documents} onSelect={onSelect} />
              <ResultGroup title="Other files" files={otherFiles} onSelect={onSelect} />
            </> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
