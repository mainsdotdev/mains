import { useState, useRef, useEffect, useLayoutEffect, ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import Text from "./text";

export type TooltipPosition =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface TooltipProps {
  id?: string;
  content: ReactNode;
  children?: ReactNode;
  /** Existing DOM trigger, for controls rendered outside React (for example, in a shadow root). */
  target?: HTMLElement | null;
  position?: TooltipPosition;
  delay?: number;
  /** Hide after this many milliseconds, even while the trigger remains hovered. */
  autoHideAfter?: number;
  className?: string;
  disabled?: boolean;
  /** Keyboard shortcut to display (e.g., "⌘," or "Ctrl+S") */
  shortcut?: string;
  /** Hide tooltip when clicking on the trigger element */
  hideOnClick?: boolean;
  /** Keep larger tooltip cards inside the window as their content loads. */
  constrainToViewport?: boolean;
  /** Allow reading or scrolling a larger card without dismissing it. */
  interactive?: boolean;
}

export default function Tooltip({
  id,
  content,
  children,
  target,
  position = "top",
  delay = 20,
  autoHideAfter,
  className,
  disabled = false,
  shortcut,
  hideOnClick = false,
  constrainToViewport = false,
  interactive = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const frameRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLElement>(null);

  const updatePosition = () => {
    // Wrapped children and externally created controls share the same positioning.
    const element =
      target ?? (triggerRef.current?.firstElementChild as HTMLElement | null);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (position) {
      case "top":
        top = rect.top - gap;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - gap;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + gap;
        break;
      case "top-left":
        top = rect.top - gap;
        left = rect.right;
        break;
      case "top-right":
        top = rect.top - gap;
        left = rect.left;
        break;
      case "bottom-left":
        top = rect.bottom + gap;
        left = rect.right;
        break;
      case "bottom-right":
        top = rect.bottom + gap;
        left = rect.left;
        break;
    }

    setCoords({ top, left });
  };

  // Every scheduled callback is tracked so a newer show/hide replaces it and
  // unmount cancels it — an orphaned one sets state after the component (or a
  // test's jsdom) is gone.
  const cancelPending = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (autoHideTimeoutRef.current) {
      clearTimeout(autoHideTimeoutRef.current);
      autoHideTimeoutRef.current = null;
    }
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const showTooltip = () => {
    if (disabled) return;
    // Hover and focus can both open it, and a pending hide would close it again.
    cancelPending();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      updatePosition();
      setShouldRender(true);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        setIsVisible(true);
      });
      if (autoHideAfter !== undefined) {
        autoHideTimeoutRef.current = setTimeout(() => {
          autoHideTimeoutRef.current = null;
          hideTooltip();
        }, autoHideAfter);
      }
    }, delay);
  };

  const hideTooltip = () => {
    cancelPending();
    setIsVisible(false);
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      setShouldRender(false);
    }, 100);
  };

  useEffect(() => cancelPending, []);

  const showRef = useRef(showTooltip);
  const hideRef = useRef(hideTooltip);
  useEffect(() => {
    showRef.current = showTooltip;
    hideRef.current = hideTooltip;
  });
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!shouldRender || !constrainToViewport || !tooltip) return;
    const fit = () => {
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      const x =
        position === "left" || position.endsWith("-left")
          ? 1
          : position === "top" || position === "bottom"
            ? 0.5
            : 0;
      const y =
        position === "top" || position.startsWith("top-")
          ? 1
          : position === "left" || position === "right"
            ? 0.5
            : 0;
      tooltip.style.left = `${Math.max(8 + width * x, Math.min(coords.left, window.innerWidth - 8 - width * (1 - x)))}px`;
      tooltip.style.top = `${Math.max(8 + height * y, Math.min(coords.top, window.innerHeight - 8 - height * (1 - y)))}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(tooltip);
    window.addEventListener("resize", fit);
    // A scroll can move the trigger inside the rail's overflow area.
    const hide = (event: Event) => {
      if (event.target instanceof Node && tooltip.contains(event.target))
        return;
      hideRef.current();
    };
    window.addEventListener("scroll", hide, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", hide, true);
    };
  }, [shouldRender, constrainToViewport, position, coords]);

  useEffect(() => {
    if (!target || disabled) return;
    const show = () => showRef.current();
    const hide = () => hideRef.current();
    target.addEventListener("mouseenter", show);
    target.addEventListener("mouseleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
    if (hideOnClick) target.addEventListener("click", hide);
    return () => {
      target.removeEventListener("mouseenter", show);
      target.removeEventListener("mouseleave", hide);
      target.removeEventListener("focus", show);
      target.removeEventListener("blur", hide);
      if (hideOnClick) target.removeEventListener("click", hide);
    };
  }, [target, disabled, hideOnClick]);

  if (disabled) {
    return <>{children}</>;
  }

  const getTransformOrigin = () => {
    switch (position) {
      case "top":
        return "translate(-50%, -100%)";
      case "bottom":
        return "translate(-50%, 0)";
      case "left":
        return "translate(-100%, -50%)";
      case "right":
        return "translate(0, -50%)";
      case "top-left":
        return "translate(-100%, -100%)";
      case "top-right":
        return "translate(0, -100%)";
      case "bottom-left":
        return "translate(-100%, 0)";
      case "bottom-right":
        return "translate(0, 0)";
    }
  };

  const tooltipElement = shouldRender
    ? createPortal(
        <Text
          id={id}
          ref={tooltipRef}
          as="div"
          size="xs"
          tone="contrast"
          role="tooltip"
          onMouseEnter={
            interactive
              ? () => {
                  cancelPending();
                  setIsVisible(true);
                }
              : undefined
          }
          onMouseLeave={interactive ? hideTooltip : undefined}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            transform: getTransformOrigin(),
            zIndex: "var(--z-tooltip)",
          }}
          className={cn(
            "px-2 py-1 whitespace-nowrap rounded-[10px] pointer-events-none glass-surface",
            "shadow-lg shadow-primary-950/10 ",
            "transition-all duration-50 ease-out",
            "flex items-center gap-2",
            interactive && "pointer-events-auto",
            isVisible ? "opacity-100 scale-100" : "opacity-0 scale-90",
            className,
          )}
        >
          <div>{content}</div>
          {shortcut && (
            <Text as="span" size="inherit" tone="subtle" weight="normal">
              {shortcut}
            </Text>
          )}
        </Text>,
        document.body,
      )
    : null;

  return target ? (
    tooltipElement
  ) : (
    <>
      <span
        ref={triggerRef}
        role="presentation"
        style={{ display: "contents" }}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onClick={hideOnClick ? hideTooltip : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") hideTooltip();
        }}
      >
        {children}
      </span>
      {tooltipElement}
    </>
  );
}
