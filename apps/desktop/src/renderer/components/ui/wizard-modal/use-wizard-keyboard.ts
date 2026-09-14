import { useEffect } from "react";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useWizardEscape(
  open: boolean,
  isSubmitting: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        e.preventDefault();
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, isSubmitting, close]);
}

export function useWizardFocusTrap(open: boolean, stepIndex: number) {
  useEffect(() => {
    if (!open) return;

    const modalEl = document.getElementById("wizard-modal-container");
    if (!modalEl) return;

    const focusFirst = () => {
      const focusable =
        modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const firstFocusable = Array.from(focusable).find(
        (el) => !el.hasAttribute("disabled"),
      );
      firstFocusable?.focus();
    };

    requestAnimationFrame(focusFirst);

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusable = Array.from(
        modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled"));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open, stepIndex]);
}
