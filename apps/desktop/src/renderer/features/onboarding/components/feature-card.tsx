import { Text } from "@/components/ui";
import { iconTintClass } from "@/lib/icon-registry";
import { cn } from "@/lib/cn";
import type { CoreFeature } from "../onboarding-features";

interface FeatureCardProps {
  feature: CoreFeature;
  /** Position in the grid — drives the staggered entrance. */
  index: number;
  animate: boolean;
}

/**
 * One tile of the core-features tour: a dimmed mini-UI backdrop, an app-icon
 * style tile in the middle, and the title with its short blurb underneath.
 */
export function FeatureCard({ feature, index, animate }: FeatureCardProps) {
  const { title, blurb, Icon, accent, preview, previewPlacement } = feature;
  return (
    <div
      className={cn(
        "group relative aspect-[1.55] overflow-hidden rounded-3xl",
        "bg-primary-100/40 dark:bg-primary-900/10 glass-outline glass-outline-soft",
        "transition-transform duration-300 ease-out hover:-translate-y-0.5",
      )}
      style={
        animate
          ? {
              animation: "slide-fade-up 420ms cubic-bezier(0.22,1,0.36,1) both",
              animationDelay: `${120 + index * 55}ms`,
            }
          : undefined
      }
    >
      {/* Backdrop: the preview bleeds past the top-left like a cropped screenshot */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 select-none",
          "opacity-30 transition-opacity duration-300 group-hover:opacity-70",
          "mask-[linear-gradient(to_bottom,black_0%,black_55%,transparent_96%)]",
        )}
      >
        <div
          className={cn(
            "absolute top-6",
            previewPlacement === "center"
              ? "inset-x-0 flex justify-center"
              : "left-8 origin-top-left scale-[1.08]",
          )}
        >
          {preview}
        </div>
      </div>

      {/* Foreground: the label bar along the bottom — tile at the left, title
          and blurb to its right. The preview's mask has already faded to
          nothing by this band, so it needs no scrim of its own; the text
          shadows cover the previews that reach furthest down. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-5">
        {/* Glass tile, tinted icon — the app colours icons, never surfaces, so
            a saturated app-icon slab would be the one thing here that isn't
            Mains. The blur lifts it off whichever mockup sits behind it. */}
        <span
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl",
            "bg-primary-50/70 backdrop-blur-md glass-outline dark:bg-primary/2",
            "shadow-[0_6px_18px_-12px_rgba(0,0,0,0.6)]",
            "transition-transform duration-300 ease-out group-hover:scale-105",
          )}
        >
          <Icon className={cn("size-6.5", iconTintClass(accent))} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <Text
            as="span"
            size="sm"
            weight="medium"
            tone="contrast"
            className="[text-shadow:0_1px_3px_rgb(255_255_255/0.55)] dark:[text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
          >
            {title}
          </Text>
          <Text
            as="span"
            size="s"
            tone="secondary"
            className="[text-shadow:0_1px_3px_rgb(255_255_255/0.5)] dark:[text-shadow:0_1px_3px_rgb(0_0_0/0.55)]"
          >
            {blurb}
          </Text>
        </div>
      </div>

    </div>
  );
}
