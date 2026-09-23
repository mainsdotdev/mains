import { useState } from "react";
import { Input } from "@/components/ui";
import { contrastRatio, isHexColor } from "@/lib/color";

interface ColorFieldProps {
  /** `#rrggbb`. */
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
}

/**
 * A colour pill for Settings › Appearance: filled with the colour it holds,
 * a swatch that opens the system picker, and the hex, editable in place.
 *
 * The one place a literal colour paints the UI on purpose — the pill shows
 * the user's pick, not a theme token — so its ink is chosen against that
 * colour rather than the theme.
 */
export function ColorField({
  value,
  onChange,
  "aria-label": label,
}: ColorFieldProps) {
  const [draft, setDraft] = useState(value);
  const [syncedFrom, setSyncedFrom] = useState(value);
  // Adopt outside changes (a preset switch, an import) without an effect.
  if (syncedFrom !== value) {
    setSyncedFrom(value);
    setDraft(value);
  }

  const ink =
    contrastRatio(value, "#ffffff") >= contrastRatio(value, "#0c0c0c")
      ? "#ffffff"
      : "#0c0c0c";

  const commit = () => {
    const next = (draft.startsWith("#") ? draft : `#${draft}`).toLowerCase();
    if (isHexColor(next) && next !== value) onChange(next);
    else setDraft(value);
  };

  return (
    <div
      className="flex h-7 w-32 items-center gap-2 rounded-[10px] border border-primary-950/10 px-2 dark:border-primary/10"
      style={{ backgroundColor: value, color: ink }}
    >
      <label className="relative size-3.5 shrink-0 cursor-pointer rounded-full ring-1 ring-current/50">
        <Input
          variant="bare"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Pick ${label.toLowerCase()}`}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <Input
        variant="bare"
        value={draft.toUpperCase()}
        onChange={(event) => setDraft(event.target.value.trim())}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          // Revert in place; blurring here would commit the stale draft.
          if (event.key === "Escape") setDraft(value);
        }}
        maxLength={7}
        spellCheck={false}
        aria-label={label}
        // The ink follows the pill, not the theme's text colour.
        className="flex-1 bg-transparent font-mono text-xs text-inherit dark:text-inherit"
      />
    </div>
  );
}
