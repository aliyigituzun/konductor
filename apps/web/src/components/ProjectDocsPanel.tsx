import React, { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const s: Record<string, React.CSSProperties> = {
  layout: {
    display: "grid",
    gridTemplateColumns: "1fr 200px",
    gap: 24,
    alignItems: "start",
  },
  content: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: "24px 28px",
    boxShadow: "var(--shadow-soft)",
    minHeight: 400,
  },
  sidebar: {
    background: "var(--bg-canvas)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    boxShadow: "var(--shadow-soft)",
    position: "sticky",
    top: 72,
  },
  sidebarHeader: {
    padding: "10px 14px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    borderBottom: "1px solid var(--border-subtle)",
    background: "var(--bg-panel)",
  },
  fileItem: {
    display: "block",
    padding: "8px 14px",
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderBottom: "1px solid var(--border-subtle)",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left" as const,
    borderLeft: "3px solid transparent",
    transition: "background 0.1s",
  },
  fileItemActive: {
    color: "var(--text-primary)",
    fontWeight: 500,
    borderLeft: "3px solid var(--text-primary)",
    background: "var(--bg-panel)",
  },
  loading: {
    color: "var(--text-tertiary)",
    fontSize: 13,
    padding: "16px 0",
  },
  empty: {
    color: "var(--text-tertiary)",
    fontSize: 13,
  },
};

interface ProjectDocsPanelProps {
  projectId: string;
}

export function ProjectDocsPanel({ projectId }: ProjectDocsPanelProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);

  useEffect(() => {
    fetch(`/api/project/${projectId}/docs`)
      .then((r) => r.json())
      .then((data: { files: string[] }) => {
        setFiles(data.files);
        if (data.files.length > 0) setSelected(data.files[0] ?? null);
      })
      .catch(console.error)
      .finally(() => setLoadingFiles(false));
  }, [projectId]);

  useEffect(() => {
    if (!selected) return;
    setLoadingContent(true);
    fetch(`/api/project/${projectId}/doc?file=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((data: { content: string }) => setContent(data.content))
      .catch(console.error)
      .finally(() => setLoadingContent(false));
  }, [selected, projectId]);

  if (loadingFiles) {
    return <p style={s.loading}>Loading docs…</p>;
  }

  if (files.length === 0) {
    return <p style={s.empty}>No .md files found in this project.</p>;
  }

  return (
    <div style={s.layout}>
      <div style={s.content}>
        {loadingContent ? (
          <p style={s.loading}>Loading…</p>
        ) : (
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      <aside style={s.sidebar}>
        <div style={s.sidebarHeader}>Documents</div>
        {files.map((file) => (
          <button
            key={file}
            style={{
              ...s.fileItem,
              ...(selected === file ? s.fileItemActive : {}),
            }}
            onClick={() => setSelected(file)}
          >
            {file}
          </button>
        ))}
      </aside>
    </div>
  );
}
