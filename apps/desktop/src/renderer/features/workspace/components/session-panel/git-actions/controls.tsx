import type { ReactNode } from "react";
import { AsciiSpinner, Button, Checkbox, Text } from "@/components/ui";
import { Sparkles } from "@/components/ui/icons";

/**
 * A checkbox with its label. Six of these sit across the commit, PR, and
 * publish forms; giving them one component is what keeps them one size and one
 * colour, instead of six chances to drift apart.
 */
export function CheckboxOption({
  checked,
  onChange,
  className,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Text
      as="label"
      size="xs"
      tone="subtle"
      className={`flex cursor-pointer select-none items-center gap-2 ${className ?? ""}`}
    >
      <Checkbox checked={checked} onChange={onChange} />
      {children}
    </Text>
  );
}

/**
 * A placeholder that shimmers while the model writes the field's contents.
 *
 * It has to be a real element: `.shine-text` paints text through
 * `background-clip`, which `::placeholder` can't carry. So the field's own
 * placeholder steps aside for the duration and this lies over it, matching the
 * control's padding (`px-3 py-2`) so the line lands exactly where the
 * placeholder was. Inert to the pointer and hidden from assistive tech — the
 * field underneath is still the thing being clicked and read.
 */
export function ShinePlaceholder({ children }: { children: ReactNode }) {
  return (
    <Text
      as="span"
      size="xs"
      tone="inherit"
      aria-hidden
      className="shine-text pointer-events-none absolute inset-x-3 top-2 truncate"
    >
      {children}
    </Text>
  );
}

/**
 * The "Generate" affordance tucked into the bottom-right of a textarea — one in
 * the commit form, one in the PR form. Same size, same placement, same spinner:
 * two copies of this markup had already been kept in sync by hand.
 *
 * Leaving the field blank and pressing the action button still generates
 * inline; this is the explicit version, so the action itself stays instant.
 */
export function GenerateButton({
  onClick,
  disabled,
  generating,
  tooltip,
}: {
  onClick: () => void;
  disabled: boolean;
  generating: boolean;
  tooltip: string;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      tooltip={tooltip}
      tooltipPosition="top-left"
      className="absolute glass-primary bottom-3 right-2 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary-600 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100 bg-primary-100/60 hover:bg-primary-200/60 dark:bg-primary-800/40 dark:hover:bg-primary-700/40 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
    >
      {generating ? (
        <>
          <AsciiSpinner kind="generate" className="size-3" />
          Generating
        </>
      ) : (
        <>
          <Sparkles className="size-3" />
          Generate
        </>
      )}
    </Button>
  );
}
