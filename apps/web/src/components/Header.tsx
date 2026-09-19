import React, { useContext } from "react";
import { Link, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { AppContext } from "../AppContext.js";
import { useAuth } from "../AuthContext.js";
import "./Header.css";

const TABS = [
  { id: "status", label: "Status" },
  { id: "features", label: "Features" },
  { id: "todos", label: "To-dos" },
  { id: "agents", label: "Agents" },
  { id: "assets", label: "Assets" },
  { id: "reviews", label: "Reviews" },
  { id: "docs", label: "Project Details" },
] as const;

type TabId = typeof TABS[number]["id"];

export function Header() {
  const { projectName, projectProfileName } = useContext(AppContext);
  const { status, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch("/project/:id");
  const deepMatch = useMatch("/project/:id/*");
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = match?.params.id ?? deepMatch?.params.id ?? null;
  const isFeatureCategoryPage = location.pathname.includes("/features/");
  const activeTab = (isFeatureCategoryPage ? "features" : (searchParams.get("tab") ?? "status")) as TabId;
  const isProjectPage = !!projectId;

  if (location.pathname.startsWith("/review/")) return null;

  function setTab(tab: TabId) {
    if (!projectId) return;
    if (isFeatureCategoryPage || location.pathname !== `/project/${projectId}`) {
      navigate(`/project/${projectId}?tab=${tab}`);
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      next.delete("agentConfig");
      return next;
    });
  }

  function openProjectConfiguration() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("config", "general");
      return next;
    });
  }

  return (
    <header className="hdr">
      <div className="hdr__crumbs">
        {isProjectPage ? (
          <>
            <Link to="/" className="hdr__crumb">{projectProfileName}</Link>
            <span className="hdr__sep" aria-hidden="true">/</span>
            <span className="hdr__crumb hdr__crumb--current">{projectName ?? "…"}</span>
          </>
        ) : (
          <Link to="/" className="hdr__crumb hdr__wordmark">{projectProfileName}</Link>
        )}
      </div>

      {isProjectPage ? (
        <nav className="hdr__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`hdr__tab${activeTab === tab.id ? " hdr__tab--active" : ""}`}
              onClick={() => setTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      ) : <span />}

      <div className="hdr__right">
        {status?.principal ? (
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            onClick={() => { void signOut(); }}
            title={`Signed in as ${status.principal.user.email}`}
          >
            Sign out
          </button>
        ) : null}
        {isProjectPage ? (
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--icon"
            onClick={openProjectConfiguration}
            aria-label="Project configuration"
            title="Project configuration"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        ) : null}
      </div>
    </header>
  );
}
