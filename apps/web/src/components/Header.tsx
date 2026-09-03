import React, { useContext } from "react";
import { Link, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { AppContext } from "../AppContext.js";

const TABS = [
  { id: "status", label: "Status" },
  { id: "features", label: "Features" },
  { id: "agents", label: "Agents" },
  { id: "docs", label: "Project Details" },
] as const;

type TabId = typeof TABS[number]["id"];

const s: Record<string, React.CSSProperties> = {
  header: {
    height: 48,
    background: "var(--bg-canvas)",
    borderBottom: "1px solid var(--border-subtle)",
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    padding: "0 24px",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--text-primary)",
  },
  chevron: {
    fontSize: 13,
    color: "var(--border-strong)",
    fontWeight: 400,
    lineHeight: 1,
  },
  projectName: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-secondary)",
  },
  nav: {
    display: "flex",
    gap: 2,
    background: "var(--bg-panel)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)",
    padding: 3,
  },
  tab: {
    padding: "4px 14px",
    borderRadius: "4px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    background: "none",
    border: "none",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    transition: "background 0.1s, color 0.1s",
  },
  tabActive: {
    background: "var(--bg-canvas)",
    color: "var(--text-primary)",
    boxShadow: "0 1px 2px rgba(16,24,40,0.08)",
  },
};

export function Header() {
  const { projectName } = useContext(AppContext);
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch("/project/:id");
  const deepMatch = useMatch("/project/:id/*");
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = match?.params.id ?? deepMatch?.params.id ?? null;
  const isFeatureCategoryPage = location.pathname.includes("/features/");
  const activeTab = (isFeatureCategoryPage ? "features" : (searchParams.get("tab") ?? "status")) as TabId;

  const isProjectPage = !!projectId;

  function setTab(tab: TabId) {
    if (!projectId) return;
    if (isFeatureCategoryPage || location.pathname !== `/project/${projectId}`) {
      navigate(`/project/${projectId}?tab=${tab}`);
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  }

  return (
    <header style={s.header}>
      <div style={s.left}>
        <Link to="/" style={s.wordmark}>konductor</Link>
        {isProjectPage && projectName && (
          <>
            <span style={s.chevron}>›</span>
            <span style={s.projectName}>{projectName}</span>
          </>
        )}
      </div>

      {isProjectPage && (
        <nav style={s.nav}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              style={{ ...s.tab, ...(activeTab === tab.id ? s.tabActive : {}) }}
              onClick={() => setTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <div />
    </header>
  );
}
