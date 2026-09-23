import { useLayoutEffect, useRef } from "react";
import {
  Button,
  getNextSegmentedValue,
  HorizontalFadeScroller,
  Text,
  type SegmentedTabsNavigationKey,
} from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/cn";
import {
  paintedPalette,
  resolveAppearance,
  themeFrameColor,
  type AppearanceChoice,
  type ThemeAppearance,
} from "@/lib/app-themes";

export interface ThemePresetOption {
  value: string;
  label: string;
  /** A second line under the name — which theme "Default" follows. */
  hint?: string;
  /** What the tile paints. */
  choice: AppearanceChoice;
}

/** The rail's edge fade (3rem): a tile scrolled into view clears it. */
const FADE_WIDTH = 48;

const NAV_KEYS = new Set<string>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

/**
 * A miniature window in the theme's colours: the frame with a sidebar, the
 * content surface inset in it, "Aa" in the foreground and an accent dot. Like
 * the colour pills, a preview of literal colours rather than theme tokens.
 */
function ThemeThumbnail({
  choice,
  appearance,
}: {
  choice: AppearanceChoice;
  appearance: ThemeAppearance;
}) {
  const resolved = resolveAppearance(choice, appearance);
  const { background, foreground, accent } = paintedPalette(
    resolved,
    appearance,
  );
  return (
    <span
      aria-hidden
      className="flex h-14 w-full overflow-hidden rounded-xl border border-primary-950/10 dark:border-primary/10"
      style={{ backgroundColor: themeFrameColor(resolved, appearance) }}
    >
      <span className="flex w-4 shrink-0 flex-col gap-1 px-1 pt-2.5">
        <span
          className="h-1 rounded-full opacity-25"
          style={{ backgroundColor: foreground }}
        />
        <span
          className="h-1 w-2/3 rounded-full opacity-15"
          style={{ backgroundColor: foreground }}
        />
      </span>
      <span
        className="my-1 mr-1 flex flex-1 items-end justify-between rounded-lg px-2 pb-1.5"
        style={{ backgroundColor: background, color: foreground }}
      >
        <span className="text-xs font-semibold leading-none">Aa</span>
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: accent }}
        />
      </span>
    </span>
  );
}

/**
 * Settings › Appearance's preset picker: one row of theme thumbnails that
 * scrolls sideways, as a radio group. The selected tile is kept in view —
 * on open, on a tab switch, and as arrow keys move the selection.
 */
export function ThemePresetStrip({
  appearance,
  options,
  value,
  onChange,
  "aria-label": label,
}: {
  appearance: ThemeAppearance;
  options: ThemePresetOption[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef(new Map<string, HTMLButtonElement>());
  const reducedMotion = usePrefersReducedMotion();
  const hasSelected = options.some((option) => option.value === value);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tile = tileRefs.current.get(value);
    if (!strip || !tile) return;
    const rail = strip.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    const offset =
      box.left < rail.left + FADE_WIDTH
        ? box.left - rail.left - FADE_WIDTH
        : box.right > rail.right - FADE_WIDTH
          ? box.right - rail.right + FADE_WIDTH
          : 0;
    if (offset !== 0) {
      strip.scrollBy({
        left: offset,
        behavior: reducedMotion ? "auto" : "smooth",
      });
    }
  }, [value, appearance, reducedMotion]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!NAV_KEYS.has(event.key)) return;
    event.preventDefault();
    const next = getNextSegmentedValue(
      options.map((option) => option.value),
      value,
      event.key as SegmentedTabsNavigationKey,
    );
    if (!next) return;
    tileRefs.current.get(next)?.focus({ preventScroll: true });
    if (next !== value) onChange(next);
  };

  return (
    <div role="radiogroup" aria-label={label}>
      <HorizontalFadeScroller
        ref={stripRef}
        arrows
        // Centred on the thumbnail, not the tile: half its ring frame
        // (h-14 plus p-0.5 above and below).
        arrowClassName="top-7.5"
        // Snap tiles to just past the left fade, not under it.
        className="scroll-px-12"
        contentClassName="flex w-max gap-3 px-0.5 pr-10"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <Button
              key={option.value}
              variant="bare"
              ref={(el) => {
                if (el) tileRefs.current.set(option.value, el);
                else tileRefs.current.delete(option.value);
              }}
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (!hasSelected && index === 0) ? 0 : -1}
              onClick={() => onChange(option.value)}
              onKeyDown={handleKeyDown}
              className="group flex w-24 shrink-0 snap-start flex-col gap-1.5 text-left"
            >
              <span
                className={cn(
                  "block rounded-[14px] p-0.5 ring-inset transition-shadow duration-200",
                  selected
                    ? "ring-2 ring-accent"
                    : "ring-1 ring-transparent group-hover:ring-primary-300 dark:group-hover:ring-primary-700",
                  "group-focus-visible:ring-2 group-focus-visible:ring-accent/70",
                )}
              >
                <ThemeThumbnail choice={option.choice} appearance={appearance} />
              </span>
              <span className="flex min-w-0 flex-col px-0.5">
                <Text
                  as="span"
                  size="xs"
                  weight="medium"
                  tone={selected ? "default" : "secondary"}
                  className="truncate"
                >
                  {option.label}
                </Text>
                {option.hint && (
                  <Text as="span" size="t" tone="subtle" className="truncate">
                    {option.hint}
                  </Text>
                )}
              </span>
            </Button>
          );
        })}
      </HorizontalFadeScroller>
    </div>
  );
}
