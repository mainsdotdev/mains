import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "../../lib/cn";

export type FormControlVariant = "default" | "bare";

const sharedControlClasses =
  "min-w-0 text-primary-900 dark:text-primary-100 placeholder:text-primary-500 dark:placeholder:text-primary-500 focus:outline-none transition disabled:cursor-not-allowed disabled:opacity-60";

// `glass-input` paints both the fill and the rim. The bare variant deliberately
// owns no surface or layout styles so compact, inline, and embedded controls can
// still share the semantic primitive without changing their visual treatment.
const controlVariantClasses: Record<FormControlVariant, string> = {
  default: "w-full rounded-xl glass-input px-3 py-2 text-sm",
  bare: "",
};
const errorClasses = "[--glass-rim:var(--color-danger)]";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
  variant?: FormControlVariant;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = "",
      hasError,
      variant = "default",
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => (
    <input
      ref={ref}
      aria-invalid={hasError ? true : ariaInvalid}
      className={cn(
        sharedControlClasses,
        controlVariantClasses[variant],
        hasError && errorClasses,
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
  variant?: FormControlVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className = "",
      hasError,
      variant = "default",
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => (
    <textarea
      ref={ref}
      aria-invalid={hasError ? true : ariaInvalid}
      className={cn(
        sharedControlClasses,
        controlVariantClasses[variant],
        variant === "default" && "min-h-16 resize-y",
        hasError && errorClasses,
        className,
      )}
      {...props}
    />
  ),
);

Textarea.displayName = "Textarea";

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
  variant?: FormControlVariant;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  (
    {
      className = "",
      hasError,
      variant = "default",
      children,
      "aria-invalid": ariaInvalid,
      ...props
    },
    ref,
  ) => (
    <select
      ref={ref}
      aria-invalid={hasError ? true : ariaInvalid}
      className={cn(
        sharedControlClasses,
        controlVariantClasses[variant],
        variant === "default" && "pr-8",
        hasError && errorClasses,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);

NativeSelect.displayName = "NativeSelect";
