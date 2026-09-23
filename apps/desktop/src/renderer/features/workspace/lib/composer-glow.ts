/**
 * The empty-state (centered) composer's backlight, in the accent.
 *
 * The accent is a CSS variable the app theme can swap — per provider, too —
 * so the glow colour is derived in CSS with relative colour syntax rather
 * than in JS: a theme change repaints it without re-rendering the composer.
 * The accent is re-lit per mode, since it sits mid-lightness and would read
 * as a hard ring on either page: dark at 22% lightness (10% posterizes into
 * visible rings against the near-black page), light at 90%.
 */
export function composerGlowShadow(isDarkMode: boolean): string {
  const color = isDarkMode
    ? "hsl(from var(--color-accent) h s 22%)"
    : "hsl(from var(--color-accent) h s 90%)";
  // Three stacked layers — a near halo hugging the edge, a mid bloom, a wide
  // faded wash — so the light falls off instead of stopping at a ring. Dark
  // drops the spreads: on a near-black page each spread's shoulder reads as a
  // concentric band, so it leans on blur alone.
  const layers = isDarkMode
    ? [
        `0 0 32px 0 ${color}`,
        `0 0 20px 0 color-mix(in srgb, ${color} 15%, transparent)`,
      ]
    : [
        `0 0 20px 4px ${color}`,
        `0 0 48px 12px ${color}`,
        `0 0 96px 24px color-mix(in srgb, ${color} 55%, transparent)`,
      ];
  return layers.join(", ");
}
