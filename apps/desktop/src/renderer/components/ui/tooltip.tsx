import { useState, useRef, useEffect, ReactNode } from "react";
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
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
  disabled?: boolean;
  /** Keyboard shortcut to display (e.g., "⌘," or "Ctrl+S") */
  shortcut?: string;
  /** Hide tooltip when clicking on the trigger element */
  hideOnClick?: boolean;
}

export default function Tooltip({
  content,
  children,
  position = "top",
  delay = 20,
  className,
  disabled = false,
  shortcut,
  hideOnClick = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    // Get the first child element for positioning
    const element = triggerRef.current.firstElementChild as HTMLElement;
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

  const showTooltip = () => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => {
      updatePosition();
      setShouldRender(true);
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    }, delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
    setTimeout(() => {
      setShouldRender(false);
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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
          as="div"
          size="xs"
          tone="contrast"
          role="tooltip"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            transform: getTransformOrigin(),
            zIndex: 9999,
          }}
          className={cn(
            "px-2 py-1 whitespace-nowrap rounded-[10px] pointer-events-none glass-surface",
            "shadow-lg shadow-primary-950/10 ",
            "transition-all duration-50 ease-out",
            "flex items-center gap-2",
            isVisible ? "opacity-100 scale-100" : "opacity-0 scale-90",
            className,
          )}
        >
          <span>{content}</span>
          {shortcut && (
            <Text as="span" size="inherit" tone="subtle" weight="normal">
              {shortcut}
            </Text>
          )}
        </Text>,
        document.body,
      )
    : null;

  return (
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
      >
        {children}
      </span>
      {tooltipElement}
    </>
  );
}
