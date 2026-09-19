import React, { useEffect, useState } from "react";

export interface StatusNavItem {
  id: string;
  label: string;
  count?: number;
  tone?: "danger" | "warning";
}

interface StatusNavProps {
  items: StatusNavItem[];
  /** The scroll container holding the sections; used to track the active one. */
  scroller: React.RefObject<HTMLElement>;
}

/** Sidebar navigator for the Status tab: jumps to a section and follows the scroll. */
export function StatusNav({ items, scroller }: StatusNavProps) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      let current: string | null = items[0]?.id ?? null;
      for (const item of items) {
        const section = document.getElementById(item.id);
        if (!section) continue;
        if (section.getBoundingClientRect().top - top <= 48) current = item.id;
      }
      // At the very bottom the last section wins even if it is short.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2 && items.length > 0) current = items[items.length - 1]!.id;
      setActive(current);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [items, scroller]);

  return (
    <nav className="stnav" aria-label="Status sections">
      <div className="stnav__title">On this page</div>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`stnav__item${active === item.id ? " stnav__item--active" : ""}`}
          onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          <span className="stnav__label">{item.label}</span>
          {item.count !== undefined ? (
            <span className={`k-section__count${item.tone ? ` stnav__count--${item.tone}` : ""}`}>{item.count}</span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
