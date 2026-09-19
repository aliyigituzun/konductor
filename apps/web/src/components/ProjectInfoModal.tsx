import React from "react";
import type { ProjectImportantPaths } from "../lib/types.js";

interface ProjectInfoModalProps {
  paths: ProjectImportantPaths;
  onClose: () => void;
}

export function ProjectInfoModal({ paths, onClose }: ProjectInfoModalProps) {
  return (
    <div className="k-backdrop" onClick={onClose}>
      <div className="k-dialog" style={{ width: "min(680px, 100%)" }} onClick={(event) => event.stopPropagation()}>
        <div className="k-dialog__header">
          Paths
          <span className="k-spacer" />
          <button type="button" className="k-dialog__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="k-dialog__body">
          <dl className="k-kv" style={{ gap: "6px 14px" }}>
            {Object.entries(paths).map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key.replace(/_/g, " ")}</dt>
                <dd className="k-mono">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
