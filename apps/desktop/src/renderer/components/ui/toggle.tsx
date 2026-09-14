import { useId } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import Text from "./text";

interface ToggleBaseProps {
  id?: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export type ToggleProps = ToggleBaseProps &
  (
    | { label: string; "aria-label"?: string }
    | { label?: undefined; "aria-label": string }
  );

export function Toggle({
  id,
  enabled,
  onChange,
  label,
  className,
  disabled = false,
  "aria-label": ariaLabel,
}: ToggleProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = label ? `${controlId}-label` : undefined;

  return (
    <div className={cn("flex items-center justify-between py-2", className)}>
      {label && (
        <div className="flex flex-col">
          <Text as="span" id={labelId}>
            {label}
          </Text>
        </div>
      )}
      <Button
        id={controlId}
        variant="bare"
        role="switch"
        aria-checked={enabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelId}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={cn(
          "relative inline-flex h-5 w-12 shrink-0 items-center rounded-full transition-all",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-40",
          enabled ? "bg-success" : "glass-toggle",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-4.5 w-6.5 transform rounded-full bg-primary-100 shadow-sm transition-transform",
            enabled ? "translate-x-5.25" : "translate-x-px",
          )}
        />
      </Button>
    </div>
  );
}
