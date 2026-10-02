import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Text, focusNextFrom } from "@/components/ui";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { cn } from "@/lib/cn";
import { formatCompactRelativeDate } from "@/lib/format-date";

export interface SidebarItemQuickAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  pressed?: boolean;
  variant?: "default" | "danger";
}

const OPEN_DELAY = 450;
const CLOSE_DELAY = 150;
const GAP = 8;
const VIEWPORT_PADDING = 8;
const CARD_WIDTH = 192;
const OPEN_EVENT = "mains:sidebar-hover-card-open";

/** An interactive row preview; unlike a tooltip, its actions can take focus. */
export function SidebarItemHoverCard({
  title,
  description,
  updatedAt,
  actions,
  disabled = false,
  className,
  onHover,
  children,
}: {
  title: string;
  description?: string;
  updatedAt?: string | number | Date | null;
  actions: SidebarItemQuickAction[];
  disabled?: boolean;
  className?: string;
  onHover?: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressed = useRef(false);
  const hoveringControl = useRef(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    origin: string;
  } | null>(null);
  const [overlapsBrowser, setOverlapsBrowser] = useState(false);
  const [now, setNow] = useState(Date.now);
  const visible = position !== null && !disabled;
  const updatedLabel =
    updatedAt == null ? "" : formatCompactRelativeDate(updatedAt, now);

  if (disabled && position !== null) setPosition(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    suppressed.current = true;
    setPosition(null);
  }, [clearTimers]);

  const trigger = () =>
    anchorRef.current?.querySelector<HTMLElement>('[role="button"]');

  const open = () => {
    clearTimers();
    if (disabled || suppressed.current || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: titleId }));
    setNow(Date.now());
    setPosition({ left: rect.right + GAP, top: rect.top, origin: "top left" });
  };

  const scheduleOpen = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    if (disabled || suppressed.current || visible) return;
    clearTimers();
    openTimer.current = setTimeout(open, OPEN_DELAY);
  };

  const scheduleClose = () => {
    clearTimers();
    // Briefly tolerate travel outside both surfaces; the gap itself has a
    // transparent hit area so a slow crossing does not depend on this timer.
    closeTimer.current = setTimeout(() => {
      if (cardRef.current?.contains(document.activeElement)) return;
      setPosition(null);
    }, CLOSE_DELAY);
  };

  useEffect(() => clearTimers, [clearTimers]);
  useEffect(() => {
    if (!visible || updatedAt == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [visible, updatedAt]);
  useEffect(() => {
    if (!disabled) return;
    clearTimers();
    suppressed.current = true;
  }, [disabled, clearTimers]);

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !cardRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const width = Math.min(
      cardRef.current.offsetWidth || CARD_WIDTH,
      window.innerWidth - VIEWPORT_PADDING * 2,
    );
    const height = cardRef.current.offsetHeight;
    const desiredLeft =
      anchor.right + GAP + width <= window.innerWidth - VIEWPORT_PADDING
        ? anchor.right + GAP
        : anchor.left - GAP - width;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(desiredLeft, window.innerWidth - width - VIEWPORT_PADDING),
    );
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(anchor.top, window.innerHeight - height - VIEWPORT_PADDING),
    );
    const origin = `${top < anchor.top ? "bottom" : "top"} ${left < anchor.left ? "right" : "left"}`;
    setPosition((current) =>
      current?.left === left && current.top === top && current.origin === origin
        ? current
        : { left, top, origin },
    );

    // A native browser view paints above DOM portals. Suppress it only when
    // this card actually crosses into the browser, not on every sidebar hover.
    const browser = document
      .querySelector("[data-browser-content]")
      ?.getBoundingClientRect();
    setOverlapsBrowser(
      !!browser &&
        left < browser.right &&
        left + width > browser.left &&
        top < browser.bottom &&
        top + height > browser.top,
    );
  }, [visible, title, description, actions.length, updatedAt, now]);

  useSuppressBrowserView(visible && overlapsBrowser);

  useEffect(() => {
    if (!visible) return;
    const closeOtherCard = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== titleId) dismiss();
    };
    const clickOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !anchorRef.current?.contains(target) &&
        !cardRef.current?.contains(target)
      )
        dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const wasInCard = cardRef.current?.contains(document.activeElement);
      event.preventDefault();
      dismiss();
      if (wasInCard) trigger()?.focus();
    };
    const scrollOutside = (event: Event) => {
      if (!cardRef.current?.contains(event.target as Node)) dismiss();
    };
    window.addEventListener(OPEN_EVENT, closeOtherCard);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", scrollOutside, true);
    document.addEventListener("pointerdown", clickOutside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener(OPEN_EVENT, closeOtherCard);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", scrollOutside, true);
      document.removeEventListener("pointerdown", clickOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [visible, dismiss, titleId]);

  return (
    <>
      <div
        ref={anchorRef}
        className={className}
        onMouseEnter={(event) => {
          onHover?.();
          if (event.buttons !== 0) {
            dismiss();
            return;
          }
          if ((event.target as Element).closest("button, input")) {
            hoveringControl.current = true;
            return;
          }
          scheduleOpen();
        }}
        onMouseMove={(event) => {
          if (event.buttons !== 0) {
            dismiss();
            return;
          }
          // Do not start a preview over row controls, but keep an open card
          // while crossing them on the way to its actions.
          if ((event.target as Element).closest("button, input")) {
            hoveringControl.current = true;
            if (!visible) dismiss();
          } else if (hoveringControl.current) {
            hoveringControl.current = false;
            suppressed.current = false;
            scheduleOpen();
          }
        }}
        onMouseLeave={() => {
          suppressed.current = false;
          hoveringControl.current = false;
          scheduleClose();
        }}
        onPointerDownCapture={dismiss}
        onFocus={(event) => {
          if (event.target === trigger()) scheduleOpen();
        }}
        onBlur={(event) => {
          if (
            !anchorRef.current?.contains(event.relatedTarget as Node | null) &&
            !cardRef.current?.contains(event.relatedTarget as Node | null)
          )
            scheduleClose();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== trigger() ||
            event.key !== "ArrowRight" ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            disabled
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          suppressed.current = false;
          open();
          requestAnimationFrame(() =>
            cardRef.current
              ?.querySelector<HTMLButtonElement>("button")
              ?.focus(),
          );
        }}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-labelledby={titleId}
            className="fixed z-(--z-dropdown) w-48 max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] rounded-2xl glass-surface p-2.5 animate-dropdown-in"
            style={{
              left: position.left,
              top: position.top,
              transformOrigin: position.origin,
            }}
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            onFocus={clearTimers}
            onBlur={(event) => {
              if (
                !cardRef.current?.contains(
                  event.relatedTarget as Node | null,
                ) &&
                !anchorRef.current?.contains(event.relatedTarget as Node | null)
              )
                scheduleClose();
            }}
            onKeyDown={(event) => {
              const buttons = Array.from(
                cardRef.current?.querySelectorAll<HTMLButtonElement>(
                  "button",
                ) ?? [],
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                dismiss();
                trigger()?.focus();
              } else if (event.key === "Tab") {
                event.preventDefault();
                const next = buttons[index + (event.shiftKey ? -1 : 1)];
                if (next) next.focus();
                else {
                  const anchor = trigger() ?? null;
                  dismiss();
                  requestAnimationFrame(() => {
                    if (event.shiftKey) anchor?.focus();
                    else focusNextFrom(anchor, false);
                  });
                }
              }
            }}
          >
            <div
              aria-hidden="true"
              data-hover-bridge=""
              className={`absolute inset-y-0 w-2 ${position.origin.endsWith("right") ? "-right-2" : "-left-2"}`}
              onMouseEnter={clearTimers}
            />
            <div className="max-h-[calc(100vh-2.25rem)] overflow-y-auto">
              <div className="flex items-baseline justify-between gap-2">
                <Text
                  id={titleId}
                  size="s"
                  tone="contrast"
                  weight="medium"
                  className="min-w-0 flex-1 wrap-break-word"
                >
                  {title}
                </Text>
                {updatedLabel && (
                  <Text
                    as="span"
                    size="xs"
                    tone="muted"
                    className="shrink-0 tabular-nums"
                    aria-label={`Last updated ${updatedLabel}`}
                  >
                    {updatedLabel}
                  </Text>
                )}
              </div>
              {description && (
                <Text
                  size="xs"
                  tone="muted"
                  className="mt-1 whitespace-pre-line wrap-break-word"
                >
                  {description}
                </Text>
              )}
              <div
                className="mt-3 flex items-center justify-around gap-1"
                role="group"
                aria-label="Quick actions"
              >
                {actions.map((action) => (
                  <Button
                    key={action.label}
                    variant="icon"
                    aria-label={action.label}
                    aria-pressed={action.pressed}
                    tooltip={action.label}
                    tooltipPosition="bottom"
                    tabIndex={-1}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-lg",
                      action.variant === "danger" && "text-danger dark:text-danger",
                    )}
                    onClick={() => {
                      const anchor = trigger();
                      dismiss();
                      action.onSelect();
                      // Let an editor/modal opened by the action keep its focus.
                      requestAnimationFrame(() => {
                        if (document.activeElement === document.body)
                          anchor?.focus();
                      });
                    }}
                  >
                    {action.icon}
                  </Button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
