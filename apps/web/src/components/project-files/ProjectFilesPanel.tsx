import React, { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { SplitPane } from "./SplitPane.js";
import { FileExplorer } from "./FileExplorer.js";
import { FileViewer } from "./FileViewer.js";
import "./ProjectFiles.css";

interface ProjectFilesPanelProps {
  projectId: string;
}

/** The Project Details tab: an explorer over the repo and a viewer for what is picked. */
export function ProjectFilesPanel({ projectId }: ProjectFilesPanelProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = searchParams.get("file");

  const select = useCallback((path: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("file", path);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <SplitPane
      storageKey="konductor.explorer.width"
      side={<FileExplorer projectId={projectId} selected={selected} onSelect={select} />}
      drawerLabel={selected ? selected.split("/").pop() ?? "Files" : "Files"}
    >
      <FileViewer projectId={projectId} path={selected} />
    </SplitPane>
  );
}
