import { Children, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TabStripProps extends HTMLAttributes<HTMLDivElement> {
  activeKey?: string;
  createAction?: ReactNode;
}

/** Equal-width tabs own scrolling; the create action always stays reachable. */
export function TabStrip({ children, activeKey, createAction, className, role, "aria-label": label, onKeyDown, ...props }: TabStripProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const tabCount = Children.toArray(children).length;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const revealSelection = () => {
      const active = viewport.querySelector<HTMLElement>('[data-tab-active="true"]');
      if (!active || viewport.clientWidth === 0) return;
      const bounds = viewport.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      const style = getComputedStyle(viewport);
      const left = bounds.left + (Number.parseFloat(style.paddingLeft) || 0);
      const right = bounds.right - (Number.parseFloat(style.paddingRight) || 0);
      // A lane narrower than one tab can only show its leading edge. Keeping
      // that edge stable avoids alternating between both ends on resize.
      const delta = tab.width > right - left || tab.left < left
        ? tab.left - left
        : tab.right > right ? tab.right - right : 0;
      if (delta) viewport.scrollLeft += delta;
    };
    revealSelection();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", revealSelection);
      return () => window.removeEventListener("resize", revealSelection);
    }
    const observer = new ResizeObserver(revealSelection);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeKey, tabCount]);

  return (
    // Offset the corner gutter so the first tab's face stays flush. The owning
    // main area or preview's inset container clips tabs at its content boundary.
    <div {...props} data-tab-strip="" className={cn("relative -ml-3 flex min-w-0 flex-1 items-end", className)}>
      <div ref={viewportRef} data-tab-viewport="" role={role} aria-label={label} onKeyDown={onKeyDown}
        className="relative flex min-w-0 items-end overflow-x-auto px-3 noscrollbar">
        {children}
      </div>
      {createAction && <div data-tab-create="" className="mb-1.5 flex shrink-0 items-center">{createAction}</div>}
    </div>
  );
}
