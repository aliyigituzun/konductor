import React, { useState } from "react";
import type { Phase, PhaseItem } from "../lib/types.js";
import { itemStatusColor, itemStatusGlyph } from "../styles/ui.js";
import "./PhaseBoard.css";

const VISIBLE_ITEM_LIMIT = 6;

function ItemRow({ item }: { item: PhaseItem }) {
  return (
    <div className="pb__item">
      <span className="k-glyph" style={{ color: itemStatusColor(item.status) }}>{itemStatusGlyph(item.status)}</span>
      <span className="pb__item-title">{item.title}</span>
      <span className="k-row__meta">{item.type}</span>
    </div>
  );
}

interface PhaseBoardProps {
  phases: Phase[];
}

export function PhaseBoard({ phases }: PhaseBoardProps) {
  const [showDone, setShowDone] = useState(false);
  const [openPhase, setOpenPhase] = useState<Phase | null>(null);

  const doneCount = phases.filter((p) => p.status === "done").length;
  const visible = showDone ? phases : phases.filter((p) => p.status !== "done");

  return (
    <section className="k-section">
      <div className="k-section__header">
        Phases
        <span className="k-section__count">{phases.length}</span>
        <span className="k-spacer" />
        {doneCount > 0 && (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide done" : `+${doneCount} done`}
          </button>
        )}
      </div>
      <div className="k-section__body">
        {visible.length === 0 ? (
          <p className="k-empty">{phases.length === 0 ? "No phases" : "All phases done"}</p>
        ) : (
          <div className="pb__grid">
            {visible.map((phase) => {
              const done = phase.items.filter((i) => i.status === "done").length;
              const total = phase.items.length;
              const itemsToShow = phase.items.slice(0, VISIBLE_ITEM_LIMIT);
              const hidden = total - itemsToShow.length;
              return (
                <div key={phase.id} className="k-card pb__phase" style={{ padding: 0 }}>
                  <div className="pb__phase-head">
                    <span className="pb__phase-title">{phase.title}</span>
                    <span className="k-tag">{phase.status.replace("_", " ")}</span>
                    <span className="k-faint k-num" style={{ fontSize: 11 }}>{done}/{total}</span>
                  </div>
                  {total > 0 && (
                    <div className="k-progress" style={{ borderRadius: 0 }}>
                      <div className="k-progress__fill" style={{ width: `${(done / total) * 100}%` }} />
                    </div>
                  )}
                  {itemsToShow.map((item) => <ItemRow key={item.id} item={item} />)}
                  {hidden > 0 && (
                    <div className="pb__more">
                      <button type="button" className="k-link" style={{ fontSize: 11 }} onClick={() => setOpenPhase(phase)}>
                        +{hidden} more
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openPhase ? (
        <div className="k-backdrop" onClick={() => setOpenPhase(null)}>
          <div className="k-dialog" style={{ width: "min(720px, 100%)" }} onClick={(event) => event.stopPropagation()}>
            <div className="k-dialog__header">
              {openPhase.title}
              <span className="k-section__count">{openPhase.items.length}</span>
              <span className="k-spacer" />
              <button type="button" className="k-dialog__close" onClick={() => setOpenPhase(null)} aria-label="Close">×</button>
            </div>
            <div className="k-dialog__body" style={{ padding: 0 }}>
              {openPhase.items.map((item) => <ItemRow key={item.id} item={item} />)}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
