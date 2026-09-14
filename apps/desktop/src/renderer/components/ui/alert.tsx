import {
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Body, Muted } from "./text";
import { Button } from "./button";
import { Enter } from "./icons";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";
import { useDialogFocus } from "./dialog-focus";

export interface AlertProps {
  isOpen: boolean;
  title: string;
  description: string;
  primaryButtonText: string;
  secondaryButtonText: string;
  onPrimary: () => void;
  onSecondary: () => void;
  isPrimaryLoading?: boolean;
  primaryButtonVariant?: "primary" | "danger";
  /**
   * Extra content between the description and the buttons — an opt-in the
   * confirmation itself carries, such as "also remove the directory". Enter
   * fires the primary action from anywhere in the dialog, so anything
   * focusable here must not need Enter of its own.
   */
  children?: ReactNode;
}

/**
 * Keyboard affordances for the two buttons.
 * The return glyph rides bare on the loud primary button; esc gets a keycap
 * outline so it still reads as a key on the quiet one.
 */
const EnterHint = () => (
  <kbd className="flex items-center opacity-80">
    <Enter className="size-4" />
  </kbd>
);

const EscHint = () => (
  <kbd className="rounded-md border border-current/50 px-0.5 py-px font-sans text-xt font-medium leading-4 opacity-60">
    ESC
  </kbd>
);

export default function Alert({
  isOpen,
  title,
  description,
  primaryButtonText,
  secondaryButtonText,
  onPrimary,
  onSecondary,
  isPrimaryLoading = false,
  primaryButtonVariant = "primary",
  children,
}: AlertProps) {
  // Hide the native browser view while open so this alert isn't trapped behind it.
  useSuppressBrowserView(isOpen);

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const secondaryButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const handleKeyDown = useDialogFocus({
    isOpen,
    dialogRef,
    onClose: onSecondary,
    initialFocusRef:
      primaryButtonVariant === "danger"
        ? secondaryButtonRef
        : primaryButtonRef,
    closeOnEscape: !isPrimaryLoading,
  });

  /**
   * The ↵ chip on the primary button is a promise the focus trap alone cannot
   * keep: a danger alert deliberately parks focus on the secondary button, so
   * native activation would make Enter mean Cancel. Both keycaps describe the
   * dialog, not whatever holds focus — Escape is already handled that way.
   *
   * `preventDefault` matters when focus *is* on the primary button (the
   * non-danger case): without it the button's own activation would fire the
   * action a second time.
   */
  const handleAlertKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || event.repeat) {
      handleKeyDown(event);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Both buttons are disabled mid-action; the keys follow them.
    if (!isPrimaryLoading) onPrimary();
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-(--z-modal-critical) flex items-center justify-center bg-primary-950/50 "
      role="presentation"
      onClick={isPrimaryLoading ? undefined : onSecondary}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="rounded-4xl p-6 glass-surface max-w-90 w-full animate-dropdown-in origin-center focus:outline-none"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleAlertKeyDown}
      >
        <Body as="h2" id={titleId} weight="medium" className="mb-2">
          {title}
        </Body>
        {/* Prose, not a form label — it names no control, so it must not be a
            `<label>` element. */}
        <Muted id={descriptionId} size="s">
          {description}
        </Muted>
        {children && <div className="mt-4">{children}</div>}
        <div className="flex gap-3 mt-6">
          <Button
            ref={primaryButtonRef}
            className="flex-1 rounded-full font-semibold"
            variant={primaryButtonVariant}
            onClick={onPrimary}
            disabled={isPrimaryLoading}
          >
            {isPrimaryLoading ? (
              "Loading..."
            ) : (
              <span className="flex items-center justify-center gap-1">
                {primaryButtonText}
                <EnterHint />
              </span>
            )}
          </Button>
          <Button
            ref={secondaryButtonRef}
            className="flex-1 rounded-full font-semibold"
            variant="primary"
            onClick={onSecondary}
            disabled={isPrimaryLoading}
          >
            <span className="flex items-center justify-center gap-1">
              {secondaryButtonText}
              <EscHint />
            </span>
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
