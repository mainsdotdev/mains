import * as React from "react";
import { cn } from "../../lib/cn";
import { Check } from "./icons";

export interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "checked" | "defaultChecked" | "onChange" | "className"
  > {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      checked = false,
      onChange,
      disabled = false,
      className,
      ...inputProps
    },
    ref,
  ) => {
    return (
      <span
        className={cn(
          "group relative inline-flex size-4 min-h-4 min-w-4 items-center justify-center",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange?.(event.target.checked)}
          disabled={disabled}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...inputProps}
        />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none flex size-4 items-center justify-center rounded-md glass-outline transition-[color,background-color,box-shadow] duration-200",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2",
            checked
              ? "bg-primary-800 dark:bg-primary-200 glass-fill-primary dark:glass-fill-primary-800"
              : "bg-primary-100 dark:bg-primary-800 glass-fill-primary dark:glass-fill-primary-800",
            !disabled &&
              "group-hover:glass-fill-primary-800 dark:group-hover:glass-fill-primary-200",
          )}
        >
          {checked && (
            <Check className="size-3 text-primary dark:text-primary-900" />
          )}
        </span>
      </span>
    );
  },
);

Checkbox.displayName = "Checkbox";
