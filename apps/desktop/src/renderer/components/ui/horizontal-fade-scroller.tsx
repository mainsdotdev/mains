import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { ChevronLeft } from "./icons";

/**
 * A page-turn button over one edge of the rail, shown on hover while that
 * edge has more to scroll. Out of the tab order: keyboard users scroll the
 * rail by moving focus through it.
 */
function ScrollArrow({
  side,
  visible,
  onClick,
  className,
}: {
  side: "left" | "right";
  visible: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="bare"
      tabIndex={-1}
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 z-(--z-base) flex size-7 -translate-y-1/2 items-center justify-center rounded-full glass-button text-primary-700 dark:text-primary-300",
        "opacity-0 transition-opacity duration-200",
        side === "left" ? "left-1" : "right-1",
        visible ? "group-hover/rail:opacity-100" : "pointer-events-none",
        className,
      )}
    >
      <ChevronLeft className={cn("size-3.5", side === "right" && "rotate-180")} />
    </Button>
  );
}

/**
 * Horizontal scroll rail that fades content out at whichever edge still has
 * more to scroll. Uses a CSS mask instead of overlay gradients so it works on
 * any background (light/dark, glass) without color matching. With `arrows`,
 * hovering it shows page-turn buttons — a mouse wheel only scrolls vertically.
 */
export function HorizontalFadeScroller({
  children,
  className = "",
  contentClassName = "flex gap-4 w-max",
  arrows = false,
  arrowClassName,
  ref,
}: {
  children: ReactNode;
  /** Outer (scrolling) element — for sizing it inside a flex row. */
  className?: string;
  contentClassName?: string;
  arrows?: boolean;
  /**
   * Placement for the arrows — say, a `top-*` to centre them on part of the
   * items rather than the whole rail.
   */
  arrowClassName?: string;
  /** The scrolling element, for callers that scroll it themselves. */
  ref?: Ref<HTMLDivElement | null>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(
    ref,
    () => scrollRef.current,
    [],
  );

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    updateFade();
    const observer = new ResizeObserver(updateFade);
    if (scrollRef.current) observer.observe(scrollRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [updateFade]);

  const mask = `linear-gradient(to right, ${
    fade.left ? "transparent, black 3rem" : "black"
  }, ${fade.right ? "black calc(100% - 3rem), transparent" : "black"})`;

  const rail = (
    <div
      ref={scrollRef}
      onScroll={updateFade}
      className={cn("overflow-x-auto noscrollbar snap-x", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <div ref={contentRef} className={contentClassName}>
        {children}
      </div>
    </div>
  );
  if (!arrows) return rail;

  // Most of a page per click, so the tile cut off at the edge stays in view.
  const turnPage = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  // The buttons sit outside the rail so its mask doesn't fade them too.
  return (
    <div className="group/rail relative">
      {rail}
      <ScrollArrow
        side="left"
        visible={fade.left}
        onClick={() => turnPage(-1)}
        className={arrowClassName}
      />
      <ScrollArrow
        side="right"
        visible={fade.right}
        onClick={() => turnPage(1)}
        className={arrowClassName}
      />
    </div>
  );
}
