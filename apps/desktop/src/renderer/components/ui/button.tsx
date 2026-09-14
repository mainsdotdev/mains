import React, { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";
import Tooltip, { TooltipPosition } from "./tooltip";
import { AsciiSpinner } from "./ascii-spinner";

export type ButtonVariant =
  | "primary"
  | "submit"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon"
  | "subtle"
  | "bare";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Tooltip text to show on hover */
  tooltip?: string;
  /** Keyboard shortcut to display in tooltip (e.g., "⌘," or "Ctrl+S") */
  tooltipShortcut?: string;
  /** Position of the tooltip */
  tooltipPosition?: TooltipPosition;
}

const variantStyles: Record<ButtonVariant, string> = {
  // Glass variants carry no bg-*/hover:bg-* — the `glass-*` utility owns the
  // background, and a hover:bg-* would win on specificity and wipe the rim.
  // Their hover fills come from the --glass-hover-* tokens in index.css.
  primary: "text-primary-700 dark:text-primary-300 glass-primary",
  secondary: "text-primary dark:text-primary glass-secondary",
  submit: "text-primary glass-submit",
  ghost:
    "text-primary-900 dark:text-primary-100 hover:bg-primary dark:hover:bg-primary-950/10",
  danger: "text-primary glass-danger",
  icon: "p-1 rounded-md text-primary-600 dark:text-primary-400 hover:bg-primary-200/40 dark:hover:bg-primary-700",
  subtle:
    "flex items-center gap-2 hover:bg-primary/50 dark:hover:bg-primary/5",
  bare: "",
};

// Interaction semantics belong to the primitive, not to a visual variant.
// Even a fully custom `bare` button must remain visibly focusable and expose a
// consistent disabled state.
const interactionStyles =
  "cursor-pointer duration-200 transition-[color,background-color,border-color,box-shadow,transform] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none";

const controlStyles =
  "px-3 py-1.5 text-s font-medium rounded-xl items-center justify-center";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      // Default to "button" instead of the native HTML default "submit" — keeps
      // a stray <Button> inside a future <form> from accidentally submitting it.
      // Callers that genuinely need submit pass `type="submit"` explicitly.
      type = "button",
      variant = "bare",
      isLoading = false,
      fullWidth = false,
      leftIcon,
      rightIcon,
      children,
      className = "",
      disabled,
      tooltip,
      tooltipShortcut,
      tooltipPosition = "top",
      ...props
    },
    ref,
  ) => {
    const variantClass = variantStyles[variant];
    const widthClass = fullWidth ? "w-full" : "";
    const visualBaseClass = variant === "bare" ? "" : controlStyles;

    const buttonElement = (
      <button
        ref={ref}
        type={type}
        className={cn(
          interactionStyles,
          visualBaseClass,
          variantClass,
          widthClass,
          className,
        )}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          <div className="flex items-center gap-1.5">
            {/* `inherit` so the spinner picks up the button's own text color
                (warning, danger, provider accent…) like the label beside it. */}
            <AsciiSpinner variant="inherit" kind="circle" />
            <span>Loading...</span>
          </div>
        ) : (
          <>
            {leftIcon && <span className="mr-2">{leftIcon}</span>}
            {children}
            {rightIcon && <span className="ml-2">{rightIcon}</span>}
          </>
        )}
      </button>
    );

    // Get tooltip content - only use explicit tooltip prop
    const tooltipContent = tooltip;

    // Wrap with tooltip if tooltip content is available
    if (tooltipContent) {
      return (
        <Tooltip
          content={tooltipContent}
          shortcut={tooltipShortcut}
          position={tooltipPosition}
          hideOnClick
        >
          {buttonElement}
        </Tooltip>
      );
    }

    return buttonElement;
  },
);

Button.displayName = "Button";
