import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchProjectDocs, fetchProjectFiles, formatApiError, type ProjectFileEntry } from "../../lib/registry.js";
import { FileSearchDialog } from "./FileSearchDialog.js";

interface FileExplorerProps {
  projectId: string;
  selected: string | null;
  onSelect: (path: string) => void;
}

type DirState = { entries: ProjectFileEntry[] } | { error: string } | { loading: true };

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"]);

function fileIcon(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return "M";
  if (IMAGE_EXT.has(ext)) return "I";
  if (ext === "pdf") return "P";
  return "·";
}

/**
 * Two groups: root `.md` docs (open by default) and a lazily loaded tree of the
 * whole repo. Each directory is fetched once, on first expansion.
 */
export function FileExplorer({ projectId, selected, onSelect }: FileExplorerProps) {
  const [docs, setDocs] = useState<string[] | null>(null);
  const [docsOpen, setDocsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [dirs, setDirs] = useState<Map<string, DirState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDocs(null);
    setDirs(new Map());
    setExpanded(new Set());
    setFilesOpen(false);
    fetchProjectDocs(projectId)
      .then((files) => { if (!cancelled) setDocs(files); })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, [projectId]);

  // Paths already requested, so a directory is fetched once no matter how often it is
  // expanded. Reset with the project.
  const requested = useRef<Set<string>>(new Set());
  useEffect(() => { requested.current = new Set(); }, [projectId]);

  const loadDir = useCallback((path: string) => {
    if (requested.current.has(path)) return;
    requested.current.add(path);
    setDirs((current) => new Map(current).set(path, { loading: true }));
    fetchProjectFiles(projectId, path)
      .then(({ entries }) => setDirs((latest) => new Map(latest).set(path, { entries })))
      .catch((error) => setDirs((latest) => new Map(latest).set(path, { error: formatApiError(error) })));
  }, [projectId]);

  useEffect(() => {
    if (filesOpen) loadDir("");
  }, [filesOpen, loadDir]);

  // Expand ancestors of a deep-linked file so it is visible in the tree.
  useEffect(() => {
    if (!selected || !selected.includes("/")) return;
    const parts = selected.split("/").slice(0, -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setFilesOpen(true);
    setExpanded((current) => {
      const next = new Set(current);
      ancestors.forEach((a) => next.add(a));
      return next;
    });
    loadDir("");
    ancestors.forEach(loadDir);
  }, [selected, loadDir]);

  function toggleDir(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    loadDir(path);
  }

  function renderDir(path: string, depth: number): React.ReactNode {
    const state = dirs.get(path);
    const indent = 8 + depth * 12;
    if (!state || "loading" in state) return <div className="fx__state" style={{ paddingLeft: indent }}>…</div>;
    if ("error" in state) return <div className="fx__state k-error" style={{ paddingLeft: indent }}>{state.error}</div>;
    if (state.entries.length === 0) return <div className="fx__state" style={{ paddingLeft: indent }}>empty</div>;
    return state.entries.map((entry) => {
      if (entry.kind === "dir") {
        const open = expanded.has(entry.path);
        return (
          <React.Fragment key={entry.path}>
            <button type="button" className="fx__row fx__row--dir" style={{ paddingLeft: indent }} onClick={() => toggleDir(entry.path)}>
              <span className="fx__arrow">{open ? "▾" : "▸"}</span>
              <span className="fx__name">{entry.name}</span>
            </button>
            {open ? renderDir(entry.path, depth + 1) : null}
          </React.Fragment>
        );
      }
      return (
        <button
          key={entry.path}
          type="button"
          data-drawer-close
          className={`fx__row${selected === entry.path ? " fx__row--active" : ""}`}
          style={{ paddingLeft: indent }}
          onClick={() => onSelect(entry.path)}
          title={entry.path}
        >
          <span className="fx__arrow" />
          <span className="fx__icon">{fileIcon(entry.name)}</span>
          <span className="fx__name">{entry.name}</span>
        </button>
      );
    });
  }

  return (
    <div className="fx">
      <div className="fx__search-wrap">
        <button type="button" className="fx__search" onClick={() => setSearchOpen(true)} aria-haspopup="dialog">
          <span aria-hidden="true">⌕</span>
          <span>Search files</span>
        </button>
      </div>
      <button type="button" className="fx__group" onClick={() => setDocsOpen((v) => !v)} aria-expanded={docsOpen}>
        <span className="fx__arrow">{docsOpen ? "▾" : "▸"}</span>
        Docs
        <span className="k-section__count">{docs?.length ?? ""}</span>
      </button>
      {docsOpen && (
        docs === null ? <div className="fx__state">…</div>
        : docs.length === 0 ? <div className="fx__state">no .md files</div>
        : docs.map((file) => (
          <button
            key={file}
            type="button"
            data-drawer-close
            className={`fx__row${selected === file ? " fx__row--active" : ""}`}
            style={{ paddingLeft: 20 }}
            onClick={() => onSelect(file)}
            title={file}
          >
            <span className="fx__icon">M</span>
            <span className="fx__name">{file}</span>
          </button>
        ))
      )}

      <button type="button" className="fx__group" onClick={() => setFilesOpen((v) => !v)} aria-expanded={filesOpen}>
        <span className="fx__arrow">{filesOpen ? "▾" : "▸"}</span>
        Project Files
      </button>
      {filesOpen && renderDir("", 1)}
      {searchOpen ? <FileSearchDialog projectId={projectId} onClose={() => setSearchOpen(false)} onSelect={(path) => { onSelect(path); setSearchOpen(false); }} /> : null}
    </div>
  );
}
