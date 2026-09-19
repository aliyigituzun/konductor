import React, { useCallback, useEffect, useRef, useState } from "react";

interface SplitPaneProps {
  /** localStorage key for the persisted sidebar width. */
  storageKey: string;
  defaultWidth?: number;
  minWidth?: number;
  side: React.ReactNode;
  children: React.ReactNode;
  /** Label for the narrow-viewport drawer toggle. */
  drawerLabel?: string;
  className?: string;
}

function readWidth(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A resizable sidebar + main layout. The divider is dragged with pointer events; the
 * width is written to a CSS variable so nothing re-renders while dragging. Below the
 * narrow breakpoint the sidebar stacks and collapses behind a toggle (see ui.css).
 */
export function SplitPane({
  storageKey,
  defaultWidth = 240,
  minWidth = 160,
  side,
  children,
  drawerLabel = "Files",
  className,
}: SplitPaneProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => readWidth(storageKey, defaultWidth));
  const [dragging, setDragging] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // Per-viewer convenience only.
    }
  }, [storageKey, width]);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const el = root.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const max = Math.max(minWidth, Math.floor(el.clientWidth * 0.5));
    setDragging(true);
    const move = (e: PointerEvent) => {
      const next = Math.min(max, Math.max(minWidth, e.clientX - left));
      el.style.setProperty("--pane-w", `${next}px`);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
      setWidth(Math.min(max, Math.max(minWidth, e.clientX - left)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [minWidth]);

  return (
    <div
      ref={root}
      className={`k-split${dragging ? " k-split--dragging" : ""}${className ? ` ${className}` : ""}`}
      style={{ ["--pane-w" as string]: `${width}px` }}
    >
      <button
        type="button"
        className="k-split__drawer-toggle"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((open) => !open)}
      >
        {drawerOpen ? "▾" : "▸"} {drawerLabel}
      </button>
      <aside className={`k-split__side${drawerOpen ? "" : " k-split__side--collapsed"}`} onClick={(e) => {
        // Selecting something in the drawer closes it on narrow screens.
        if ((e.target as HTMLElement).closest("[data-drawer-close]")) setDrawerOpen(false);
      }}>
        {side}
      </aside>
      <div
        className="k-split__handle"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={() => setWidth(defaultWidth)}
        title="Drag to resize · double-click to reset"
      />
      <div className="k-split__main">{children}</div>
    </div>
  );
}
