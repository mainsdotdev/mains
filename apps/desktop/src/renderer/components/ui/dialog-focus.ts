import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable]:not([contenteditable=\"false\"])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getAttribute("aria-disabled") !== "true" &&
      element.getClientRects().length > 0,
  );
}

interface DialogFocusOptions {
  isOpen: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
}

/**
 * Owns the keyboard contract shared by modal dialogs: move focus inside,
 * contain Tab/Shift+Tab, dismiss with Escape, then restore the opener.
 */
export function useDialogFocus({
  isOpen,
  dialogRef,
  onClose,
  initialFocusRef,
  closeOnEscape = true,
}: DialogFocusOptions) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const requestedFocus = initialFocusRef?.current;
      const firstFocusable = getFocusableElements(dialog)[0];
      (requestedFocus ?? firstFocusable ?? dialog).focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (!previousFocus?.isConnected) return;

      requestAnimationFrame(() => previousFocus.focus());
    };
  }, [dialogRef, initialFocusRef, isOpen]);

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscape) onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      // Portals retain React's event ancestry. Stopping Tab here prevents a
      // nested alert from also reaching the parent modal's focus trap.
      event.stopPropagation();

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeOnEscape, dialogRef],
  );
}
