import {
  getThemeVariant,
  solidColors,
  swatchGlowColor,
  swatchGlowShadow,
} from "@/lib/space-themes";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

interface SpaceThemePickerProps {
  selectedColorIndex: number;
  onSelectColor: (index: number) => void;
}

export function SpaceThemePicker({
  selectedColorIndex,
  onSelectColor,
}: SpaceThemePickerProps) {
  const { darkMode } = useDarkMode();

  return (
    <div className="flex items-center justify-center gap-4">
      {solidColors.map((colorPair, index) => {
        const isSelected = selectedColorIndex === index;
        const preview = getThemeVariant(colorPair, darkMode).preview;
        return (
          <Button
            key={`theme-${colorPair.name}-${index}`}
            type="button"
            onClick={() => onSelectColor(index)}
            title={colorPair.name}
            aria-pressed={isSelected}
            className={cn(
              "relative size-8 rounded-full shrink-0 cursor-pointer overflow-hidden",
              "border border-primary-950/15 dark:border-primary/15",
              "transition-[transform,box-shadow] duration-200 ease-out",
              isSelected ? "scale-110" : "hover:scale-110",
            )}
            style={{
              ...(colorPair.translucent ? {} : { background: preview }),
              // Selected swatch wears the composer's glow colour, tightened into a ring.
              ...(isSelected
                ? { boxShadow: swatchGlowShadow(swatchGlowColor(colorPair, darkMode)) }
                : {}),
            }}
          >
            {colorPair.translucent && (
              <>
                {/* Checkerboard so the real semi-transparent fill reads as glass, not as a flat disc. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0 bg-size-[8px_8px]",
                    "[--checker-a:var(--color-primary-200)] [--checker-b:var(--color-primary-400)]",
                    "dark:[--checker-a:var(--color-primary-700)] dark:[--checker-b:var(--color-primary-500)]",
                  )}
                  style={{
                    backgroundImage:
                      "conic-gradient(var(--checker-a) 25%, var(--checker-b) 0 50%, var(--checker-a) 0 75%, var(--checker-b) 0)",
                  }}
                />
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: preview }}
                />
              </>
            )}
          </Button>
        );
      })}
    </div>
  );
}
