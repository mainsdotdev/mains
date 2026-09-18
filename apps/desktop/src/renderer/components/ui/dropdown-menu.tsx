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
  origin?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "auto";
  /** Which enabled row receives focus when the menu opens. */
  initialFocus?: "first" | "selected";
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
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: DropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
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
    shouldRestoreFocus.current = true;
    const enabledItems = getEnabledMenuItems(menuRef.current);
    const selectedItem = enabledItems.find(
      (item) => item.getAttribute("aria-checked") === "true",
    );
    const itemToFocus =
      initialFocus === "selected"
        ? (selectedItem ?? enabledItems[0])
        : enabledItems[0];
    itemToFocus?.focus();

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
  }, [initialFocus, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;

    // Layout dimensions ignore the scale used by the opening animation.
    const { offsetWidth: width, offsetHeight: height } = menuRef.current;
    if (width <= 0 || height <= 0) return;

    setMenuSize((current) =>
      current?.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, [children, isOpen, minWidth]);

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

  if (!isOpen) return null;

  const viewportPadding = 8;
  const menuWidth = Math.max(minWidth, menuSize?.width ?? minWidth);
  // Keep the previous estimate for the first render. The layout effect above
  // replaces it with the real size before the browser paints.
  const menuHeight = menuSize?.height ?? 125;
  const spaceBelow = window.innerHeight - viewportPadding - position.y;
  const upwardAnchor = position.anchorTop ?? position.y;
  const spaceAbove = upwardAnchor - viewportPadding;
  const opensUpward = menuHeight > spaceBelow && spaceAbove > spaceBelow;
  const desiredY = opensUpward
    ? upwardAnchor - menuHeight
    : position.y;
  const adjustedPosition = {
    x: Math.max(
      viewportPadding,
      Math.min(
        position.x,
        window.innerWidth - menuWidth - viewportPadding,
      ),
    ),
    y: Math.max(
      viewportPadding,
      Math.min(
        desiredY,
        window.innerHeight - menuHeight - viewportPadding,
      ),
    ),
  };

  const getTransformOrigin = () => {
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

  return createPortal(
    <DropdownContext.Provider value={{ registerSubmenu, unregisterSubmenu }}>
      <div
        ref={menuRef}
        role="menu"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onKeyDown={handleMenuKeyDown}
        className={cn(
          "fixed z-(--z-dropdown) overflow-hidden rounded-2xl glass-surface animate-dropdown-in p-1.5",
          className,
        )}
        style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          minWidth,
          transformOrigin: getTransformOrigin(),
        }}
      >
        {children}
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
  const [submenuPosition, setSubmenuPosition] = useState({ top: 0, left: 0 });

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
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const submenuWidth = 180;
        const opensRight =
          rect.right + 4 + submenuWidth <= window.innerWidth - 8;
        setSubmenuPosition({
          top: Math.max(8, Math.min(rect.top, window.innerHeight - 160)),
          left: opensRight
            ? rect.right + 4
            : Math.max(8, rect.left - submenuWidth - 4),
        });
      }
      focusSubmenuOnOpen.current = moveFocusInside;
      setIsOpen(true);
    },
    [clearCloseTimer],
  );

  const startCloseTimer = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  }, [clearCloseTimer]);

  useLayoutEffect(() => {
    if (!isOpen || !focusSubmenuOnOpen.current) return;
    focusSubmenuOnOpen.current = false;
    getEnabledMenuItems(submenuElementRef.current)[0]?.focus();
  }, [isOpen]);

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
          "flex w-full cursor-pointer items-center gap-3 px-1.5 rounded-xl py-1.5 text-s",
          "text-primary-700 transition-colors hover:bg-primary-200/40 hover:text-primary-900",
          "dark:text-primary-300 dark:hover:bg-primary/5 dark:hover:text-primary-100",
          className,
        )}
      >
        {label}
        <ArrowUp
          aria-hidden="true"
          className="ml-auto size-3 rotate-90"
        />
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
            className="fixed z-(--z-dropdown-sub) overflow-hidden p-1.5 rounded-2xl glass-surface animate-dropdown-sub-in "
            style={{
              top: submenuPosition.top,
              left: submenuPosition.left,
              minWidth: 180,
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
        "flex w-full items-center gap-3 px-2 py-1.5 rounded-xl text-s",
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
