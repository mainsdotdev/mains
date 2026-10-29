import { Color } from "expo-router";
import { DynamicColorIOS, Platform, useColorScheme, type ColorValue } from "react-native";

import { semanticPalette } from "./semantic-palette";

export type ThemeColors = { readonly [Key in keyof typeof semanticPalette.light]: ColorValue };

// iOS semantic references follow UIKit traits. Android Fabric resolves resource
// references when props are applied, so its existing views need new hex props.
const iosColors: ThemeColors = Platform.OS === "ios"
  ? {
      label: Color.ios.label,
      secondaryLabel: Color.ios.secondaryLabel,
      tertiaryLabel: Color.ios.tertiaryLabel,
      separator: Color.ios.separator,
      systemBackground: Color.ios.systemBackground,
      secondarySystemBackground: Color.ios.secondarySystemBackground,
      tertiarySystemBackground: Color.ios.tertiarySystemBackground,
      groupedBackground: Color.ios.systemGroupedBackground,
      groupedCell: Color.ios.secondarySystemGroupedBackground,
      cardSurface: DynamicColorIOS({ light: "#F7F7F8", dark: "#1C1C1E" }),
      sheetBackground: Color.ios.secondarySystemBackground,
      sheetCardSurface: Color.ios.tertiarySystemBackground,
      fill: Color.ios.systemFill,
      systemBlue: Color.ios.systemBlue,
      systemGreen: Color.ios.systemGreen,
      systemRed: Color.ios.systemRed,
      systemOrange: Color.ios.systemOrange,
      onTint: "#ffffff",
    }
  : semanticPalette.light;

/** Every consumer subscribes, including memoized text, cards and navigation. */
export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return Platform.OS === "ios" ? iosColors : semanticPalette[scheme === "dark" ? "dark" : "light"];
}

/**
 * Brand colors — the only place the phone borrows literal values from the
 * desktop (`src/renderer/index.css`: accent #2563eb over a neutral scale).
 * Hook-only: apply inside components at render time.
 */
const brandPalette = {
  light: { accent: "#2563eb", accentSoft: "rgba(37, 99, 235, 0.12)", accentContrast: "#ffffff" },
  dark: { accent: "#3b82f6", accentSoft: "rgba(59, 130, 246, 0.18)", accentContrast: "#ffffff" },
} as const;

export function useBrandColors() {
  const scheme = useColorScheme();
  return brandPalette[scheme === "dark" ? "dark" : "light"];
}

/** Run / tool-call status → color. Running borrows the brand accent. */
export function useStatusColors() {
  const colors = useThemeColors();
  const brand = useBrandColors();
  return {
    running: brand.accent,
    queued: colors.secondaryLabel,
    succeeded: colors.systemGreen,
    done: colors.systemGreen,
    failed: colors.systemRed,
    error: colors.systemRed,
    canceled: colors.tertiaryLabel,
  } as const;
}

/**
 * Provider brand colors, lifted from the desktop's `--color-claude`,
 * `--color-copilot`, `--color-codex` and `--color-cursor`
 * (`src/renderer/index.css`) and keyed by the contract's provider ids, so a run
 * can look up the color of the agent that produced it.
 *
 * Text over a filled one of these is `colors.onTint` — white, in both modes,
 * for every provider. Claude's orange carries white at 3.1:1 rather than the
 * 4.5:1 body text usually wants; that is a deliberate call for the brand hue
 * over the ratio, and the bubble is short, high-weight text.
 */
const providerAccents = {
  claude_code: "#D97757",
  copilot_cli: "#8534F3",
  codex: "#0169CC",
  cursor: "#727272",
} as const;

/** A provider's brand color, falling back to the app's own accent. */
export function useProviderAccent(providerId: string | null | undefined): string {
  const brand = useBrandColors();
  return providerAccents[providerId as keyof typeof providerAccents] ?? brand.accent;
}

/**
 * A provider's accent as a pair: the color itself, and the wash a tinted
 * surface wears under text in that color — the same opacities as the brand's
 * `accentSoft`, so a provider-colored chip sits like a brand-colored one.
 */
export function useProviderAccentPair(providerId: string | null | undefined): {
  accent: string;
  soft: string;
} {
  const scheme = useColorScheme();
  const accent = useProviderAccent(providerId);
  return { accent, soft: withAlpha(accent, scheme === "dark" ? 0.18 : 0.12) };
}

/** `#rrggbb` at an opacity, as `rgba()`. Anything else is returned untouched. */
export function withAlpha(hex: string, alpha: number): string {
  const channels = parseHex(hex);
  if (!channels) return hex;
  const [red, green, blue] = channels;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/**
 * `#rrggbb` moved `amount` of the way toward another `#rrggbb` — 0 is the
 * colour itself, 1 is the target. Unlike `withAlpha` this stays opaque, so it
 * is what to reach for when a colour has to soften against a background it
 * cannot actually see (an SVG fill, a glyph over glass).
 *
 * Anything that is not a 6-digit hex is returned untouched, as above.
 */
export function mixToward(hex: string, target: string, amount: number): string {
  const from = parseHex(hex);
  const to = parseHex(target);
  if (!from || !to) return hex;
  const mixed = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * iOS's red / orange / green as literal values, for the one thing a
 * `PlatformColor` cannot do: be drawn at an opacity. `withAlpha` needs a hex
 * string, so a wash under `colors.systemRed` text has to spell the hue out —
 * the text itself stays the platform color, which also follows the phone's
 * contrast and colour-filter settings.
 */
const systemHues = {
  light: { red: "#FF3B30", orange: "#FF9500", green: "#34C759" },
  dark: { red: "#FF453A", orange: "#FF9F0A", green: "#30D158" },
} as const;

export function useSystemHues() {
  const scheme = useColorScheme();
  return systemHues[scheme === "dark" ? "dark" : "light"];
}

/**
 * The wash a tinted surface wears under text in a given color — a risk badge,
 * a diff line, a chip. One depth for the whole app: the same opacities as the
 * brand's `accentSoft`, a little stronger in dark, where a wash has to lift
 * off black, than in light, where it has to stay under the text it carries.
 */
export function useSoftTint(): (color: string) => string {
  const scheme = useColorScheme();
  const alpha = scheme === "dark" ? 0.18 : 0.12;
  return (color: string) => withAlpha(color, alpha);
}

/**
 * The desktop's workspace hues (`index.css`: `--color-success`, `--color-danger`,
 * `--color-warning`), borrowed so a workspace's status glyph and diff counts
 * read the same on both screens.
 *
 * The desktop only ever draws them on its dark ground. On white, green-500
 * lands at 2.3:1 — unreadable as a diff count — so light mode steps each hue
 * down the same ramp to clear 4.5:1 while staying recognisably the same color.
 */
const workspacePalette = {
  light: { success: "#15803D", danger: "#C62A20", warning: "#B45309" },
  dark: { success: "#22C55E", danger: "#FF4436", warning: "#F59E0B" },
} as const;

export function useWorkspaceColors() {
  const scheme = useColorScheme();
  return workspacePalette[scheme === "dark" ? "dark" : "light"];
}
