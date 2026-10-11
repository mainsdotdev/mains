import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { ArrowUp, Selected } from "./icons";
import { Button } from "./button";
import { focusNextFrom } from "./focus-navigation";

const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
].join(",");

const VIEWPORT_PADDING = 8;
const SUBMENU_GAP = 4;
const SUBMENU_WIDTH_ESTIMATE = 180;
const SUBMENU_HEIGHT_ESTIMATE = 160;

function clampToViewport(value: number, size: number, viewportSize: number) {
  return Math.max(
    VIEWPORT_PADDING,
    Math.min(value, viewportSize - size - VIEWPORT_PADDING),
  );
}

function placeSubmenu(
  anchor: Pick<DOMRect, "top" | "right" | "left">,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const spaceRight =
    viewport.width - VIEWPORT_PADDING - anchor.right - SUBMENU_GAP;
  const spaceLeft = anchor.left - VIEWPORT_PADDING - SUBMENU_GAP;
  const opensRight =
    size.width <= spaceRight ||
    (size.width > spaceLeft && spaceRight >= spaceLeft);
  const desiredLeft = opensRight
    ? anchor.right + SUBMENU_GAP
    : anchor.left - size.width - SUBMENU_GAP;

  return {
    top: clampToViewport(anchor.top, size.height, viewport.height),
    left: clampToViewport(desiredLeft, size.width, viewport.width),
    transformOrigin: opensRight ? "top left" : "top right",
  };
}

function getEnabledMenuItems(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter(
    (item) =>
      item.getAttribute("aria-disabled") !== "true" &&
      !(item instanceof HTMLButtonElement && item.disabled),
  );
}

function moveMenuFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): boolean {
  if (
    event.key !== "ArrowDown" &&
    event.key !== "ArrowUp" &&
    event.key !== "Home" &&
    event.key !== "End"
  ) {
    return false;
  }

  const items = getEnabledMenuItems(container);
  if (items.length === 0) return true;

  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  let nextIndex = currentIndex;

  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  else if (event.key === "ArrowDown") {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  } else {
    nextIndex =
      currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length;
  }

  event.preventDefault();
  event.stopPropagation();
  items[nextIndex]?.focus();
  return true;
}

// Parent menus register portaled submenus so clicks inside either surface do
// not count as outside clicks.
const DropdownContext = createContext<{
  registerSubmenu: (element: HTMLElement) => void;
  unregisterSubmenu: (element: HTMLElement) => void;
}>({
  registerSubmenu: () => undefined,
  unregisterSubmenu: () => undefined,
});

interface DropdownMenuBaseProps {
  isOpen: boolean;
  position: {
    x: number;
    y: number;
    /** Top edge of the trigger, used when the menu needs to open upward. */
    anchorTop?: number;
  };
  onClose: () => void;
  // Optional like its siblings (DropdownMenuSub, DropdownMenuItem): a menu
  // whose every row is conditional can legitimately render none of them.
  children?: ReactNode;
  minWidth?: number;
  className?: string;
  /** `right` keeps the horizontal animation anchor while allowing upward placement. */
  origin?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "right" | "auto";
  /** `none` lets hover previews preserve the user's current input focus. */
  initialFocus?: "first" | "selected" | "none";
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  /** A search field can receive focus before the selectable rows. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Prefer the space above the trigger even when the menu would fit below. */
  openUpward?: boolean;
  /** Bounded scrolling, edge arrows and a smooth resize as async rows arrive. */
  scrollable?: boolean;
  maxHeight?: number;
}

export type DropdownMenuProps = DropdownMenuBaseProps &
  (
    | { "aria-label": string; "aria-labelledby"?: string }
    | { "aria-label"?: undefined; "aria-labelledby": string }
  );

export function DropdownMenu({
  isOpen,
  position,
  onClose,
  children,
  minWidth = 144,
  className = "",
  origin = "auto",
  initialFocus = "first",
  initialFocusRef,
  onMouseEnter,
  onMouseLeave,
  openUpward = false,
  scrollable = false,
  maxHeight = 384,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollOverflow, setScrollOverflow] = useState(false);
  const [scrollEdges, setScrollEdges] = useState({ up: false, down: false });
  const submenuRefs = useRef<Set<HTMLElement>>(new Set());
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const shouldRestoreFocus = useRef(true);
  const [menuSize, setMenuSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const registerSubmenu = useCallback((element: HTMLElement) => {
    submenuRefs.current.add(element);
  }, []);

  const unregisterSubmenu = useCallback((element: HTMLElement) => {
    submenuRefs.current.delete(element);
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    shouldRestoreFocus.current = initialFocus !== "none";
    const enabledItems = getEnabledMenuItems(menuRef.current);
    const selectedItem = enabledItems.find(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    const itemToFocus =
      initialFocus === "selected"
        ? (selectedItem ?? enabledItems[0])
        : enabledItems[0];
    if (initialFocus !== "none" || initialFocusRef) (initialFocusRef?.current ?? itemToFocus)?.focus();

    return () => {
      const target = previouslyFocused.current;
      if (!shouldRestoreFocus.current || !target?.isConnected) return;
      // An item's action can hand focus to whatever it just opened — an inline
      // editor, a modal. Those focus calls land in the same commit as this
      // cleanup, so decide a frame later instead: reclaim the trigger only when
      // nothing else claimed focus, or the restore would blur what the item
      // opened (and blur-to-commit editors would close on the spot).
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (target.isConnected) target.focus();
      });
    };
  }, [initialFocus, initialFocusRef, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const measure = () => {
      const menu = menuRef.current;
      if (!menu) return;
      // Measure natural content, not the animated viewport's intermediate size.
      const width = menu.offsetWidth;
      const naturalHeight = scrollable && contentRef.current
        ? contentRef.current.offsetHeight + menu.offsetHeight - menu.clientHeight
        : menu.offsetHeight;
      const height = scrollable
        ? Math.min(naturalHeight, maxHeight, window.innerHeight - VIEWPORT_PADDING * 2)
        : naturalHeight;
      if (width <= 0 || height <= 0) return;
      setMenuSize((current) =>
        current?.width === width && current.height === height ? current : { width, height },
      );
      if (scrollable) setScrollOverflow(naturalHeight > height);
    };
    measure();
    if (!scrollable || !contentRef.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(contentRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children, isOpen, minWidth, scrollable, maxHeight]);

  const updateScrollEdges = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const up = viewport.scrollTop > 1;
    const down = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
    setScrollEdges((current) => current.up === up && current.down === down ? current : { up, down });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen || !scrollable || !scrollRef.current) return;
    updateScrollEdges();
    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [isOpen, scrollable, scrollOverflow, menuSize, updateScrollEdges]);

  useEffect(() => {
    if (!isOpen || !scrollable) return;
    // Initial placement settles before transitions are enabled. Later content
    // changes retarget the current height/position without scaling the text.
    const frame = requestAnimationFrame(() => {
      menuRef.current?.setAttribute("data-resize-ready", "true");
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, scrollable]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (target instanceof Element) {
        const dropdownPortal = target.closest<HTMLElement>(
          '[data-dropdown-portal="true"]',
        );
        const labelledBy = dropdownPortal?.getAttribute("aria-labelledby");
        const portalTrigger = labelledBy
          ? document.getElementById(labelledBy)
          : null;
        if (portalTrigger && menuRef.current?.contains(portalTrigger)) return;
      }
      for (const submenu of submenuRefs.current) {
        if (submenu.contains(target)) return;
      }
      shouldRestoreFocus.current = false;
      onClose();
    };

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, [isOpen, onClose]);

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Home/End move the caret in a menu's search input. Arrow keys still move
    // from that input into the rows through the normal menu navigation.
    if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
    if (moveMenuFocus(event, menuRef.current)) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      // Menu items use roving focus and are not part of the page tab sequence.
      // Continue from the trigger so a portaled menu cannot dump focus on body.
      event.preventDefault();
      shouldRestoreFocus.current = false;
      const anchor = previouslyFocused.current;
      onClose();
      requestAnimationFrame(() => focusNextFrom(anchor, event.shiftKey));
    }
  };

  if (!isOpen) {
    // The next opening starts with its own content, rather than the previous
    // file's dimensions. Reset while closed, before measuring the next portal.
    if (scrollable && menuSize !== null) setMenuSize(null);
    if (scrollable && scrollOverflow) setScrollOverflow(false);
    return null;
  }

  const viewportPadding = VIEWPORT_PADDING;
  const menuWidth = Math.max(minWidth, menuSize?.width ?? minWidth);
  // Keep the previous estimate for the first render. The layout effect above
  // replaces it with the real size before the browser paints.
  const menuHeight = menuSize?.height ?? 125;
  const spaceBelow = window.innerHeight - viewportPadding - position.y;
  const upwardAnchor = position.anchorTop ?? position.y;
  const spaceAbove = upwardAnchor - viewportPadding;
  // Async menus choose their side using the eventual height so loading apps
  // does not flip the menu across its trigger halfway through opening.
  const placementHeight = scrollable
    ? Math.min(maxHeight, window.innerHeight - viewportPadding * 2)
    : menuHeight;
  const opensUpward = openUpward || (placementHeight > spaceBelow && spaceAbove > spaceBelow);
  const desiredY = opensUpward ? upwardAnchor - menuHeight : position.y;
  const adjustedPosition = {
    x: Math.max(
      viewportPadding,
      Math.min(position.x, window.innerWidth - menuWidth - viewportPadding),
    ),
    y: Math.max(
      viewportPadding,
      Math.min(desiredY, window.innerHeight - menuHeight - viewportPadding),
    ),
  };

  const getTransformOrigin = () => {
    if (origin === "right") return opensUpward ? "bottom right" : "top right";
    if (origin !== "auto") {
      const originMap = {
        "top-left": "top left",
        "top-right": "top right",
        "bottom-left": "bottom left",
        "bottom-right": "bottom right",
      };
      return originMap[origin];
    }

    const isRight = position.x > window.innerWidth / 2;

    if (opensUpward && isRight) return "bottom right";
    if (opensUpward) return "bottom left";
    if (isRight) return "top right";
    return "top left";
  };

  const scrollArrow = (direction: "up" | "down") => (
    <div className={cn("pointer-events-none absolute inset-x-0 z-10 flex h-5 items-center justify-center", direction === "up" ? "top-0" : "bottom-0")}>
      {scrollEdges[direction] && (
        <Button
          variant="bare"
          tabIndex={-1}
          aria-label={`Scroll menu ${direction}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const viewport = scrollRef.current;
            if (!viewport) return;
            viewport.scrollBy({
              top: (direction === "up" ? -1 : 1) * viewport.clientHeight * 0.7,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            });
          }}
          className="pointer-events-auto flex h-5 w-full cursor-pointer items-center justify-center text-primary-500 hover:text-primary-900 dark:hover:text-primary-100"
        >
          <ArrowUp aria-hidden="true" className={cn("size-3", direction === "down" && "rotate-180")} />
        </Button>
      )}
    </div>
  );
  const scrollMask = `linear-gradient(to bottom, ${
    scrollOverflow && scrollEdges.up ? "transparent, black 1.5rem" : "black"
  }, ${scrollOverflow && scrollEdges.down ? "black calc(100% - 1.5rem), transparent" : "black"})`;

  return createPortal(
    <DropdownContext.Provider value={{ registerSubmenu, unregisterSubmenu }}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onKeyDown={handleMenuKeyDown}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className={cn(
          "fixed z-(--z-dropdown) overflow-hidden rounded-2xl glass-surface animate-dropdown-in",
          scrollable ? "dropdown-scroll-menu" : "p-1.25 space-y-0.5",
          className,
        )}
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          minWidth: scrollable ? Math.min(minWidth, window.innerWidth - viewportPadding * 2) : minWidth,
          ...(scrollable ? {
            height: menuSize?.height,
            maxHeight: Math.min(maxHeight, window.innerHeight - viewportPadding * 2),
            maxWidth: window.innerWidth - viewportPadding * 2,
          } : {}),
          transformOrigin: getTransformOrigin(),
        }}
      >
        {scrollable ? (
          <div className="flex h-full min-h-0 flex-col">
            <div ref={scrollRef} data-dropdown-scroll="true" onScroll={updateScrollEdges}
              className="noscrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
              style={{ maskImage: scrollMask, WebkitMaskImage: scrollMask, scrollPaddingBlock: "1.5rem" }}>
              <div ref={contentRef} data-dropdown-content="true" className="p-1.25 space-y-0.5">{children}</div>
            </div>
            {scrollOverflow && scrollArrow("up")}
            {scrollOverflow && scrollArrow("down")}
          </div>
        ) : children}
      </div>
    </DropdownContext.Provider>,
    document.body,
  );
}

export interface DropdownMenuSubProps {
  label: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function DropdownMenuSub({
  label,
  children,
  className = "",
}: DropdownMenuSubProps) {
  const { registerSubmenu, unregisterSubmenu } = useContext(DropdownContext);
  const generatedId = useId();
  const triggerId = `${generatedId}-trigger`;
  const submenuId = `${generatedId}-menu`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const submenuElementRef = useRef<HTMLDivElement | null>(null);
  const focusSubmenuOnOpen = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState({ top: 0, left: 0, transformOrigin: "top left" });

  const updateSubmenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const submenu = submenuElementRef.current;
    const width = submenu?.offsetWidth || SUBMENU_WIDTH_ESTIMATE;
    const height = submenu?.offsetHeight || SUBMENU_HEIGHT_ESTIMATE;
    const next = placeSubmenu(
      trigger.getBoundingClientRect(),
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setSubmenuPosition((current) =>
      current.top === next.top && current.left === next.left && current.transformOrigin === next.transformOrigin ? current : next,
    );
  }, []);

  const submenuRefCallback = useCallback(
    (element: HTMLDivElement | null) => {
      if (submenuElementRef.current) {
        unregisterSubmenu(submenuElementRef.current);
      }
      submenuElementRef.current = element;
      if (element) registerSubmenu(element);
    },
    [registerSubmenu, unregisterSubmenu],
  );

  const clearCloseTimer = useCallback(() => {
    if (!closeTimer.current) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closeSubmenu = useCallback(
    (restoreTriggerFocus = false) => {
      clearCloseTimer();
      setIsOpen(false);
      if (restoreTriggerFocus) triggerRef.current?.focus();
    },
    [clearCloseTimer],
  );

  const openSubmenu = useCallback(
    (moveFocusInside: boolean) => {
      clearCloseTimer();
      // Repeated pointer/click opens can happen while the submenu is already
      // mounted. Reuse its real dimensions instead of resetting the corrected
      // position back to the first-render estimate.
      updateSubmenuPosition();
      focusSubmenuOnOpen.current = moveFocusInside;
      setIsOpen(true);
    },
    [clearCloseTimer, updateSubmenuPosition],
  );

  const startCloseTimer = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    // The first position uses an estimate because the portal does not exist
    // yet. Measure the real submenu before paint and correct both axes.
    updateSubmenuPosition();
    if (focusSubmenuOnOpen.current) {
      focusSubmenuOnOpen.current = false;
      getEnabledMenuItems(submenuElementRef.current)[0]?.focus();
    }
  }, [children, isOpen, updateSubmenuPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const update = () => updateSubmenuPosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, updateSubmenuPosition]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      openSubmenu(true);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
    }
  };

  const handleSubmenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (moveMenuFocus(event, submenuElementRef.current)) return;
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
    }
  };

  return (
    <>
      <Button
        ref={triggerRef}
        id={triggerId}
        type="button"
        variant="bare"
        role="menuitem"
        tabIndex={-1}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={submenuId}
        onClick={() => openSubmenu(true)}
        onKeyDown={handleTriggerKeyDown}
        onMouseEnter={() => openSubmenu(false)}
        onMouseLeave={startCloseTimer}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 px-1.5 rounded-[10px] py-1.5 text-s",
          "text-primary-700 transition-colors hover:bg-primary-200/40 hover:text-primary-900",
          "dark:text-primary-300 dark:hover:bg-primary/5 dark:hover:text-primary-100",
          className,
        )}
      >
        {label}
        <ArrowUp aria-hidden="true" className="ml-auto size-3 rotate-90" />
      </Button>
      {isOpen &&
        createPortal(
          <div
            ref={submenuRefCallback}
            id={submenuId}
            role="menu"
            aria-labelledby={triggerId}
            onKeyDown={handleSubmenuKeyDown}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={startCloseTimer}
            className="fixed z-(--z-dropdown-sub) overflow-x-hidden overflow-y-auto p-1.5 rounded-2xl glass-surface animate-dropdown-sub-in space-y-0.5"
            style={{
              top: submenuPosition.top,
              left: submenuPosition.left,
              transformOrigin: submenuPosition.transformOrigin,
              minWidth: SUBMENU_WIDTH_ESTIMATE,
              maxWidth: window.innerWidth - VIEWPORT_PADDING * 2,
              maxHeight: window.innerHeight - VIEWPORT_PADDING * 2,
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  children?: ReactNode;
  variant?: "default" | "danger";
  className?: string;
  disabled?: boolean;
  selected?: boolean;
  indicator?: "check" | "none";
}

export function DropdownMenuItem({
  onClick,
  children,
  variant = "default",
  className = "",
  disabled = false,
  selected,
  indicator = "check",
}: DropdownMenuItemProps) {
  const variantClasses = {
    default:
      "text-primary-700 dark:text-primary-300 hover:text-primary-900 dark:hover:text-primary-100",
    danger: "text-danger dark:text-danger",
  };

  return (
    <Button
      type="button"
      variant="bare"
      role={selected === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 px-2 py-1.5 rounded-[10px] text-s",
        "focus-visible:ring-0 focus-visible:ring-offset-0",
        "transition-colors hover:bg-primary-200/40 ",
        "dark:hover:bg-primary/5 ",

        indicator === "none" && selected
          ? "bg-primary-200/40 dark:bg-primary/5"
          : "",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        variantClasses[variant],
        className,
      )}
    >
      {selected !== undefined && indicator === "check" && (
        <Selected
          aria-hidden="true"
          className={cn("size-4", selected ? "opacity-100" : "opacity-0")}
        />
      )}
      {children}
    </Button>
  );
}
