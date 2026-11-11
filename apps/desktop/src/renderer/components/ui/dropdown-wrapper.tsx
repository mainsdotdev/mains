import {
  ReactNode,
  useEffect,
  useRef,
  useState,
  type AriaRole,
  type KeyboardEventHandler,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { isAppReady } from "../../lib/app-ready";
import { useOverlayAnimation } from "@/hooks/use-overlay-lifecycle";

export interface DropdownWrapperProps {
  className?: string;
  id?: string;
  isOpen: boolean;
  children?: ReactNode;
  openUpward?: boolean;
  /** Defaults to scaling from the anchored corner; up/down reveal vertically without horizontal scaling. */
  animationDirection?: "origin" | "up" | "down";
  minWidth?: string;
  position?: "left" | "right";
  usePortal?: boolean;
  triggerRef?: React.RefObject<HTMLElement | null>;
  dropdownRef?: React.RefObject<HTMLDivElement | null>;
  /** When portal + anchored: set false so panel can grow beyond trigger width (e.g. menus with min-width). */
  matchTriggerWidth?: boolean;
  role?: AriaRole;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export default function DropdownWrapper({
  className,
  id,
  isOpen,
  children,
  openUpward = false,
  animationDirection = "origin",
  minWidth = "min-w-(--dropdown-min-width)",
  position = "left",
  usePortal = false,
  triggerRef,
  dropdownRef: externalDropdownRef,
  matchTriggerWidth = true,
  role = "menu",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  onKeyDown,
}: DropdownWrapperProps) {
  const [coords, setCoords] = useState<{
    top: number | null;
    bottom: number | null;
    left: number;
    width: number;
  } | null>(null);
  const { isAnimatedIn: animateIn } = useOverlayAnimation(isOpen, { frames: 2, immediate: !isAppReady() });
  const internalDropdownRef = useRef<HTMLDivElement>(null);
  const dropdownRef = externalDropdownRef || internalDropdownRef;

  useEffect(() => {
    if (isOpen && usePortal && triggerRef?.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: openUpward ? null : rect.bottom + 8,
        bottom: openUpward ? window.innerHeight - rect.top + 8 : null,
        left: position === "right" ? rect.right : rect.left,
        width: rect.width,
      });
    } else if (!isOpen) {
      setCoords(null);
    }
  }, [isOpen, usePortal, triggerRef, openUpward, position]);

  // Closed panels do not exist in the accessibility tree or tab order. The
  // previous opacity-only hiding left their buttons keyboard-focusable.
  if (!isOpen) return null;

  // Portal mode: wait for coords before rendering.
  if (usePortal && !coords) return null;

  const positionClass = position === "right" ? "right-0" : "left-0";
  const verticalClass = openUpward ? "bottom-10" : "top-8";

  const verticalAnimation = animationDirection !== "origin";
  const hiddenClass = animateIn
    ? verticalAnimation ? "animate-dropdown-vertical-in" : "animate-dropdown-in"
    : verticalAnimation ? "dropdown-prewarm-vertical" : "dropdown-prewarm";

  const dropdown = (
    <div
      id={id}
      data-animation-direction={animationDirection}
      ref={dropdownRef}
      className={cn(
        usePortal ? "fixed" : "absolute",
        !usePortal && positionClass,
        !usePortal && verticalClass,
        minWidth,
        "bg-linear-to-b from-primary/90 to-primary-50/80 dark:from-primary-900 dark:to-primary-800",
        "z-(--z-dropdown) glass-surface rounded-2xl",
        hiddenClass,
        verticalAnimation && "dropdown-vertical",
        className,
      )}
      style={{
        transformOrigin: verticalAnimation
          ? animationDirection === "up" ? "bottom center" : "top center"
          : openUpward
          ? position === "right"
            ? "bottom right"
            : "bottom left"
          : position === "right"
            ? "top right"
            : "top left",
        ...(usePortal && coords
          ? {
              top: coords.top !== null ? `${coords.top}px` : "auto",
              bottom: coords.bottom !== null ? `${coords.bottom}px` : "auto",
              left: position === "right" ? "auto" : `${coords.left}px`,
              right:
                position === "right"
                  ? `${window.innerWidth - coords.left}px`
                  : "auto",
              ...(matchTriggerWidth ? { width: coords.width } : {}),
            }
          : {}),
      }}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );

  if (usePortal) {
    return createPortal(dropdown, document.body);
  }

  return dropdown;
}
