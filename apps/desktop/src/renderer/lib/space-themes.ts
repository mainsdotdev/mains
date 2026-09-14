import { parseThemeConfig } from "./parse-theme-config";

export interface ThemeVariant {
  value: string;
  preview: string;
}

export interface ThemeColor {
  name: string;
  light: ThemeVariant;
  dark: ThemeVariant;
  /**
   * Carries no tint — a semi-transparent white/black that lets the app
   * backdrop show through. Swatch UIs render it over a checkerboard instead
   * of as a flat (near-black / near-white) disc.
   */
  translucent?: boolean;
}

const solid = (light: string, dark: string): ThemeColor => ({
  name: "",
  light: { value: light, preview: light },
  dark: { value: `${dark}`, preview: dark },
});

export const solidColors: ThemeColor[] = [
  { ...solid("#ffffffb3", "#00000070"), name: "Glass", translucent: true },
  { ...solid("#EEEEEEe6", "#121212e6"), name: "Light Brown" },
  { ...solid("#C6E1D4e6", "#1F3129e6"), name: "Light Green" },
  { ...solid("#C5DEEEe6", "#15232Ee6"), name: "Light Blue" },
  { ...solid("#D6D4E8e6", "#1B1B28e6"), name: "Light Purple" },
  { ...solid("#F1DFC4e6", "#332917e6"), name: "Light Yellow" },
  { ...solid("#EFD3D8e6", "#2D1A1Ce6"), name: "Light Pink" },
  { ...solid("#F2D2C7e6", "#351D16e6"), name: "Light Red" },
];

/**
 * Maps a stored `space.themeConfig` blob back to the index of the
 * `solidColors` swatch that produced it. Used by space-edit UIs to highlight
 * the currently-selected colour. Gradients (which aren't in `solidColors`)
 * fall back to index 0.
 *
 * Note: this is the swatch-matching consumer; for the general parsed shape
 * use `parseThemeConfig` from `@/lib/parse-theme-config`.
 */
export function themeConfigToSwatchIndex(
  themeConfig: string | null,
): { colorIndex: number } {
  const parsed = parseThemeConfig(themeConfig);
  const darkBg = parsed.darkBackground || "";
  if (darkBg.includes("linear-gradient") || darkBg.includes("gradient")) {
    return { colorIndex: 0 };
  }
  for (let i = 0; i < solidColors.length; i++) {
    if (solidColors[i].dark.value === darkBg) {
      return { colorIndex: i };
    }
  }
  return { colorIndex: 0 };
}

export const getThemeVariant = (
  colorPair: ThemeColor,
  isDarkMode: boolean,
): ThemeVariant => (isDarkMode ? colorPair.dark : colorPair.light);

/**
 * Glow colour from a pastel hex. CSS relative color syntax re-tints the
 * pastel per mode, and alpha scales with the pastel's own saturation so
 * neutral colours fade out instead of casting a gray shadow.
 */
function glowFromHex(hex: string, isDarkMode: boolean): string {
  // Dark sits at 22% lightness: 10% is so close to the near-black page that
  // the wide falloff posterizes into visible rings.
  return isDarkMode
    ? `hsl(from ${hex} h calc(s * 1) 22% / calc(s * 0.32))`
    : `hsl(from ${hex} h calc(s * 1) 90% / calc(s * 0.5))`;
}

/**
 * The one box-shadow recipe for a space glow, shared by every glowing surface.
 * Three stacked layers: a near halo hugging the edge, a mid bloom, and a wide
 * faded wash, so the light falls off gradually instead of stopping at a ring.
 * Dark mode drops the spreads — on a near-black page each spread's shoulder
 * reads as a concentric band — and leans on blur alone for the falloff.
 */
export function spaceGlowShadow(color: string, isDarkMode = false): string {
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

/**
 * Compact variant of {@link spaceGlowShadow} for a 32px swatch: a crisp 2px
 * halo hugging the disc plus a short falloff, so it reads as a lit ring rather
 * than a diffuse cloud at that size.
 */
export function swatchGlowShadow(color: string): string {
  return `0 0 0 1.5px color-mix(in srgb, ${color} 85%, transparent), 0 0 6px 2px color-mix(in srgb, ${color} 30%, transparent)`;
}

/** HSL saturation (0–1) of a `#rrggbb` hex. */
function hexSaturation(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return (max - min) / (l > 0.5 ? 2 - max - min : max + min);
}

/**
 * Selection glow colour for a swatch: the theme's hue, lit bright enough to
 * separate from the page. The composer's glow sits at 10% lightness in dark
 * mode — fine across a wide blur, invisible as a 2px halo on a near-black
 * page — so the swatch re-lights the same hue instead of reusing it.
 * Derives from the light pastel (dark values are near-black and carry no hue)
 * and boosts saturation since the pastels are deliberately washed out.
 * Hue-less swatches (the translucent one, and neutrals) get a neutral halo so
 * the selection stays visible.
 */
export function swatchGlowColor(
  colorPair: ThemeColor,
  isDarkMode: boolean,
): string {
  const neutral = isDarkMode ? "hsl(0 0% 100% / 0.35)" : "hsl(0 0% 0% / 0.3)";
  if (colorPair.translucent) return neutral;
  const hex = colorPair.light.value.slice(0, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return neutral;
  if (hexSaturation(hex) < 0.05) return neutral;
  return isDarkMode
    ? `hsl(from ${hex} h calc(s * 1.25) 40%)`
    : `hsl(from ${hex} h calc(s * 1.25) 55%)`;
}

/**
 * Light pastel hex the theme's hue derives from. Always the light-mode value —
 * dark swatch values are near-black and carry no usable hue. Returns `null`
 * for gradients/unset themes.
 */
function themeHueSource(themeConfig: string | null): string | null {
  const cfg = parseThemeConfig(themeConfig);
  const base =
    cfg.lightBackground ?? cfg.light?.value ?? cfg.backgroundColor ?? "";
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(base)) return null;
  return base.slice(0, 7);
}

/**
 * Ambient glow color for the active space, used to backlight the empty-state
 * composer. CSS relative color syntax re-tints the pastel per mode, and alpha
 * scales with the pastel's own saturation so neutral themes (Rose Quartz,
 * Light Brown) fade out instead of casting a gray shadow.
 */
export function spaceGlowColor(
  themeConfig: string | null,
  isDarkMode: boolean,
): string | null {
  const hex = themeHueSource(themeConfig);
  if (!hex) return null;
  return glowFromHex(hex, isDarkMode);
}

/**
 * User-message bubble background for the active space. An explicit
 * `*UserMessageBackground` in the theme blob wins; otherwise the bubble is
 * tinted from the same pastel as `spaceGlowColor`. Returns `null` when the
 * theme carries no usable color so callers keep their static fallback classes.
 */
export function spaceUserMessageBackground(
  themeConfig: string | null,
  isDarkMode: boolean,
): string | null {
  const cfg = parseThemeConfig(themeConfig);
  const explicit = isDarkMode
    ? cfg.darkUserMessageBackground
    : cfg.lightUserMessageBackground;
  if (explicit) return explicit;
  const hex = themeHueSource(themeConfig);
  if (!hex) return null;
  return isDarkMode
    ? `hsl(from ${hex} h calc(s * 1.2) 65% / 0.12)`
    : `hsl(from ${hex} h calc(s * 1.2) 85% / 0.6)`;
}


export type { ThemeVariant as SpaceThemeVariant, ThemeColor as SpaceThemeColor };
