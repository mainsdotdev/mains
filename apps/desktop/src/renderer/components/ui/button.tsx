import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import Tooltip, { type TooltipPosition } from "./tooltip";
import { AsciiSpinner } from "./ascii-spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "icon"
  | "filter"
  | "subtle"
  | "bare";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Compact actions share one surface; only dense rows use a smaller hit area. */
  iconSize?: "xs" | "sm" | "md" | "lg";
  isLoading?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Tooltip text to show on hover */
  tooltip?: string;
  /** Keyboard shortcut to display in tooltip (e.g., "⌘," or "Ctrl+S") */
  tooltipShortcut?: string;
  /** Position of the tooltip */
  tooltipPosition?: TooltipPosition;
}

const iconStyles =
  "inline-flex shrink-0 items-center justify-center rounded-xl text-primary-600 focus-visible:bg-primary-950/8 dark:text-primary-400 dark:focus-visible:bg-primary/8 [&>svg]:shrink-0";

const quietInteraction =
  "enabled:hover:bg-primary-950/8 enabled:active:bg-primary-950/13 dark:enabled:hover:bg-primary/8 dark:enabled:active:bg-primary/13";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "button-glass glass-action text-white focus-visible:ring-white/85",
  secondary: "button-glass glass-secondary text-primary-800 dark:text-primary-200",
  ghost: cn("text-primary-900 dark:text-primary-100", quietInteraction),
  danger: "button-glass glass-danger text-white focus-visible:ring-white/85",
  icon: cn(iconStyles, quietInteraction),
  filter: cn(iconStyles, quietInteraction, "enabled:hover:text-primary-900 dark:enabled:hover:text-primary-100"),
  subtle: cn("flex items-center gap-2", quietInteraction),
  bare: "",
};

const iconSizeStyles = {
  xs: "size-5 p-1 [&>svg]:size-3",
  sm: "size-6 p-1 [&>svg]:size-3.5",
  md: "size-7 p-1.5 [&>svg]:size-4",
  lg: "size-8 p-2 [&>svg]:size-4",
};

// Interaction semantics belong to the primitive, not to a visual variant.
// Even a fully custom `bare` button must remain visibly focusable and expose a
// consistent disabled state.
const interactionStyles =
  "button-control cursor-pointer duration-160 ease-out transition-[color,background-color,border-color,box-shadow,opacity,transform,--button-glass-tint] motion-reduce:transition-none disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";

const controlStyles =
  "inline-flex min-h-8 items-center justify-center rounded-xl px-3 py-1 text-s font-medium";

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      // Default to "button" instead of the native HTML default "submit" — keeps
      // a stray <Button> inside a future <form> from accidentally submitting it.
      // Callers that genuinely need submit pass `type="submit"` explicitly.
      type = "button",
      variant = "bare",
      iconSize = "md",
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
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const variantClass = variantStyles[variant];
    const widthClass = fullWidth ? "w-full" : "";
    const visualBaseClass = variant === "icon" || variant === "filter"
      ? iconSizeStyles[iconSize]
      : variant === "bare" ? "" : controlStyles;

    const buttonElement = (
      <button
        ref={ref}
        type={type}
        className={cn(
          interactionStyles,
          visualBaseClass,
          variantClass,
          widthClass,
          isLoading && "relative disabled:opacity-75",
          className,
        )}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        aria-label={ariaLabel ?? (isLoading ? "Loading..." : undefined)}
        data-button-busy={isLoading || undefined}
        {...props}
      >
        {leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {rightIcon && <span className="ml-2">{rightIcon}</span>}
        {isLoading && (
          <span aria-hidden="true" className="button-spinner pointer-events-none absolute inset-0 grid place-items-center">
            <AsciiSpinner variant="inherit" kind="circle" className="size-4" />
          </span>
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
