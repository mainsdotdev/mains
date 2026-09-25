import {
  createContext,
  useContext,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { Close } from "./icons";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { useDialogFocus } from "./dialog-focus";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** Panel overrides — sizing (w-*, max-w-*) and radius. */
  className?: string;
  /** "dim" matches Alert/WizardModal; "media" darkens + blurs for image/screenshot previews. */
  backdrop?: "dim" | "media";
  /** "panel" is the glass card; "bare" drops the fill, rim, radius, and shadow so media content floats on the backdrop. */
  surface?: "panel" | "bare";
  /** Vertical placement; command/search surfaces sit near the top edge. */
  placement?: "center" | "top";
  /** Command surfaces use a restrained entrance; "none" lets a shared view transition own the motion. */
  motion?: "default" | "command" | "none";
  /** Pairs this dialog with another surface during a same-document view transition. */
  viewTransitionName?: string;
  /** Name the dialog when its content does not use ModalHeader. */
  "aria-label"?: string;
  /** Link the dialog to a visible title when its content does not use ModalHeader. */
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Explicit opener to refocus when the dialog hides its source surface. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
}

const ModalTitleContext = createContext<string | null>(null);

/**
 * Shared modal shell: portal, backdrop click-to-close, Escape key, entrance
 * animation, and native-browser-view suppression (the embedded browser panel
 * paints above DOM content, so it must be hidden while any overlay is open).
 * Content is free-form; pair with ModalHeader for the standard title bar.
 */
export function Modal({
  isOpen,
  onClose,
  children,
  className,
  backdrop = "dim",
  surface = "panel",
  placement = "center",
  motion = "default",
  viewTransitionName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  initialFocusRef,
  returnFocusRef,
  closeOnEscape = true,
  closeOnBackdrop = true,
}: ModalProps) {
  useSuppressBrowserView(isOpen);
  const dialogRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = useId();
  const handleKeyDown = useDialogFocus({
    isOpen,
    dialogRef,
    onClose,
    initialFocusRef,
    returnFocusRef,
    closeOnEscape,
  });

  if (!isOpen) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-(--z-modal) flex justify-center p-4",
        placement === "top" ? "items-start pt-[12vh]" : "items-center",
      )}
    >
      <div
        className={cn(
          "absolute inset-0",
          backdrop === "media"
            ? "bg-black/80 "
            : "dark:bg-primary-950/60 bg-primary/80",
        )}
        role="presentation"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={
          ariaLabel ? undefined : (ariaLabelledBy ?? generatedTitleId)
        }
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative flex flex-col max-h-[92vh] focus:outline-none",
          surface === "panel" &&
            "glass-surface rounded-xl shadow-2xl overflow-hidden",
          className,
        )}
        style={{
          viewTransitionName,
          animation:
            motion === "none"
              ? "none"
              : motion === "command"
              ? "commandMenuIn 120ms cubic-bezier(0.2, 0.8, 0.2, 1) both"
              : "wizardModalIn 20ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <ModalTitleContext.Provider value={generatedTitleId}>
          {children}
        </ModalTitleContext.Provider>
      </div>
    </div>,
    document.body,
  );
}

export interface ModalHeaderProps {
  onClose: () => void;
  children?: ReactNode;
  closeIcon?: ReactNode;
  closeLabel?: string;
}

/** Standard modal title bar: content on the left, close button on the right. */
export function ModalHeader({
  onClose,
  children,
  closeIcon,
  closeLabel = "Close",
}: ModalHeaderProps) {
  const titleId = useContext(ModalTitleContext) ?? undefined;

  return (
    <div className="flex items-center justify-between px-4 py-2.5  shrink-0">
      <div id={titleId} className="flex items-center gap-2 min-w-0 flex-1">
        {children}
      </div>
      <Button
        onClick={onClose}
        aria-label={closeLabel}
        tooltip={closeIcon ? closeLabel : undefined}
        tooltipPosition="bottom-left"
        className="ml-3 shrink-0 p-1.5 rounded-full  hover:bg-primary-200 dark:hover:bg-primary-800 transition-colors cursor-pointer"
      >
        {closeIcon ?? <Close className="size-4 text-primary-500" />}
      </Button>
    </div>
  );
}
