import {
  contrastRatio,
  mixOklab,
  oklabLightness,
  shiftLightness,
} from "./color";

/**
 * App themes — Settings › General › Appearance.
 *
 * A theme is a palette per appearance. It restyles no component: every
 * surface, border, hover fill and text colour in the renderer is already a
 * step of the one neutral scale (`--color-primary`, `--color-primary-50` …
 * `-950`, declared `@theme static` in index.css), so a theme re-derives that
 * scale and the whole app follows. Hover states included —
 * `hover:bg-primary-200/60` compiles to `color-mix(var(--color-primary-200) …)`
 * and resolves at use time.
 *
 * The scale runs light → dark in both modes: light mode paints surfaces with
 * its low steps and text with its high ones, dark mode the reverse. So the
 * palette pins the ends by appearance — light puts the background at
 * `--color-primary` and the foreground at `-950`, dark the other way round —
 * and every step in between keeps the position it has in the stock scale.
 *
 * The stock "Mains" theme has no palette. It leaves index.css alone, so the
 * app looks exactly as it did before themes existed.
 *
 * Which theme is in force depends on the active provider: the settings hold a
 * default choice and per-provider overrides (`AppThemeSettings`), and the
 * accent can come from the provider's brand colour instead of the theme.
 */

export type ThemeAppearance = "light" | "dark";

export interface ThemePalette {
  /** Content background, `#rrggbb`. The window frame is derived from it. */
  readonly background: string;
  /** Primary text, `#rrggbb`. */
  readonly foreground: string;
  /** Submit buttons, links, focus accents, `#rrggbb`. */
  readonly accent: string;
  /**
   * 0–1. Pulls the text half of the scale toward the foreground, leaving the
   * surface half alone; 0 is the palette as designed. Low-contrast palettes
   * need it to keep secondary text readable (see `liftTextSteps`).
   */
  readonly contrast: number;
}

export interface AppThemePreset {
  readonly id: string;
  readonly name: string;
  /**
   * What the theme offers per appearance: a palette, `null` for the stock
   * scale in index.css, or no key when it has nothing for that appearance
   * (Tokyo Night is dark-only).
   */
  readonly palettes: Partial<Record<ThemeAppearance, ThemePalette | null>>;
}

export const DEFAULT_APP_THEME_ID = "mains";

// Every palette here must keep secondary text at WCAG AA — the contrast
// values are what that takes, and `app-themes.test.ts` holds each one to it.
export const APP_THEME_PRESETS: readonly AppThemePreset[] = [
  {
    id: DEFAULT_APP_THEME_ID,
    name: "Mains",
    palettes: { light: null, dark: null },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    palettes: {
      dark: {
        background: "#1a1b26",
        foreground: "#a9b1d6",
        accent: "#7aa2f7",
        contrast: 0.3,
      },
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    palettes: {
      light: {
        background: "#eff1f5",
        foreground: "#4c4f69",
        accent: "#8839ef",
        contrast: 1,
      },
      dark: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        accent: "#cba6f7",
        contrast: 0,
      },
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    palettes: {
      light: {
        background: "#fbf1c7",
        foreground: "#3c3836",
        accent: "#076678",
        contrast: 0.6,
      },
      dark: {
        background: "#282828",
        foreground: "#ebdbb2",
        accent: "#83a598",
        contrast: 0,
      },
    },
  },
];

/** The themes that offer something for `appearance`, in menu order. */
export function appThemesFor(appearance: ThemeAppearance): AppThemePreset[] {
  return APP_THEME_PRESETS.filter((preset) => appearance in preset.palettes);
}

/**
 * The stock scale as a palette: index.css's content backgrounds, scale ends
 * and accent. Nothing derives a scale from it — a stock appearance emits none
 * — but a provider accent shown on stock is fitted and inked against it.
 */
const STOCK_PALETTES: Record<ThemeAppearance, ThemePalette> = {
  light: {
    background: "#ffffff",
    foreground: "#0c0c0c",
    accent: "#2563eb",
    contrast: 0,
  },
  dark: {
    background: "#0c0c0c",
    foreground: "#ffffff",
    accent: "#2563eb",
    contrast: 0,
  },
};

/** The stock frame, opaque (index.css's `--app-frame` without its alpha). */
const STOCK_FRAMES: Record<ThemeAppearance, string> = {
  light: "#ffffff",
  dark: "#000000",
};

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

/** Where the accent comes from: the theme, or the active provider's brand. */
export type ThemeAccentSource = "theme" | "provider";

/** One scope's picks: a theme id per appearance, and the accent source. */
export interface ThemeChoice {
  readonly light: string;
  readonly dark: string;
  readonly accent: ThemeAccentSource;
}

/**
 * Settings › General › Appearance. `default` applies to every provider; a
 * provider's entry overrides any subset of it. A key the entry lacks follows
 * the default, so changing the default moves every provider that didn't opt
 * out of that key.
 */
export interface AppThemeSettings {
  readonly default: ThemeChoice;
  readonly providers: Readonly<Record<string, Partial<ThemeChoice>>>;
}

export const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
  default: {
    light: DEFAULT_APP_THEME_ID,
    dark: DEFAULT_APP_THEME_ID,
    accent: "theme",
  },
  providers: {},
};

const isAccentSource = (value: unknown): value is ThemeAccentSource =>
  value === "theme" || value === "provider";

/**
 * Shape check for the persisted blob, which the pre-paint read can't trust.
 * Override entries aren't checked key by key: resolution already treats an
 * unknown theme id as stock and anything but "provider" as the theme accent.
 */
export function isAppThemeSettings(value: unknown): value is AppThemeSettings {
  if (!value || typeof value !== "object") return false;
  const { default: base, providers } = value as Record<string, unknown>;
  if (!base || typeof base !== "object") return false;
  if (!providers || typeof providers !== "object") return false;
  const { light, dark, accent } = base as Record<string, unknown>;
  return (
    typeof light === "string" &&
    typeof dark === "string" &&
    isAccentSource(accent)
  );
}

/** The picks in force for `providerId` — `null` before it is known. */
export function themeChoiceFor(
  settings: AppThemeSettings,
  providerId: string | null,
): ThemeChoice {
  const override = providerId ? settings.providers[providerId] : undefined;
  return { ...settings.default, ...override };
}

/** One edit from the settings page; `providerId: null` edits the default. */
export type ThemeChoiceChange =
  | {
      providerId: string | null;
      key: "light" | "dark";
      value: string | null;
    }
  | {
      providerId: string | null;
      key: "accent";
      value: ThemeAccentSource | null;
    };

/**
 * `value: null` drops a provider's override of `key`, handing it back to the
 * default — and drops the provider's entry once nothing is left in it. The
 * default has nothing to fall back to, so a null there is ignored.
 */
export function applyThemeChoice(
  settings: AppThemeSettings,
  change: ThemeChoiceChange,
): AppThemeSettings {
  const { providerId, key, value } = change;
  if (providerId === null) {
    if (value === null) return settings;
    return { ...settings, default: { ...settings.default, [key]: value } };
  }
  const { [key]: _replaced, ...kept } = settings.providers[providerId] ?? {};
  const override = value === null ? kept : { ...kept, [key]: value };
  const { [providerId]: _previous, ...others } = settings.providers;
  return {
    ...settings,
    providers:
      Object.keys(override).length > 0
        ? { ...others, [providerId]: override }
        : others,
  };
}

// ─────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────

/** WCAG AA for text: `text-accent` sets copy in the accent. */
const ACCENT_MIN_CONTRAST = 4.5;

/**
 * A brand colour made readable on `background`: moved in OKLab lightness,
 * away from the background, until it reaches AA — hue and chroma kept, so
 * Claude stays Claude's orange. Theme accents are hand-picked and tested
 * instead, so they never go through this.
 */
export function fitAccent(color: string, background: string): string {
  const step = oklabLightness(background) < 0.5 ? 0.01 : -0.01;
  let fitted = color;
  for (
    let i = 1;
    i <= 100 && contrastRatio(fitted, background) < ACCENT_MIN_CONTRAST;
    i++
  ) {
    fitted = shiftLightness(color, step * i);
  }
  return fitted;
}

/** One appearance, resolved. */
export interface ResolvedAppearance {
  /** What the scale derives from; `null` is the stock scale. */
  readonly palette: ThemePalette | null;
  /** An accent over the palette's (or stock's) own; `null` keeps that one. */
  readonly accent: string | null;
}

export interface ResolvedAppTheme {
  readonly light: ResolvedAppearance;
  readonly dark: ResolvedAppearance;
}

/**
 * An id that is unknown (a preset since removed) or not offered for that
 * appearance falls back to stock rather than failing. A provider accent needs
 * `brandColor`; without one (Cursor's mark is gray) the theme's stays.
 */
export function resolveAppTheme(
  choice: ThemeChoice,
  brandColor: string | null,
): ResolvedAppTheme {
  const resolve = (appearance: ThemeAppearance): ResolvedAppearance => {
    const palette =
      APP_THEME_PRESETS.find((preset) => preset.id === choice[appearance])
        ?.palettes[appearance] ?? null;
    const accent =
      choice.accent === "provider" && brandColor
        ? fitAccent(
            brandColor,
            (palette ?? STOCK_PALETTES[appearance]).background,
          )
        : null;
    return { palette, accent };
  };
  return { light: resolve("light"), dark: resolve("dark") };
}

/**
 * Each step of the stock scale, with where it sits between the scale's white
 * end (`--color-primary`, 0) and its black end (`-950`, 1) in OKLab
 * lightness. Measured from the literals in index.css — `app-themes.test.ts`
 * re-measures them from the stylesheet, so the two can't drift. (`-50` is
 * darker than `-100` there too; the positions keep that.)
 */
export const SCALE_STEPS: ReadonlyArray<readonly [string, number]> = [
  ["--color-primary", 0],
  ["--color-primary-50", 0.059],
  ["--color-primary-100", 0.029],
  ["--color-primary-200", 0.157],
  ["--color-primary-300", 0.268],
  ["--color-primary-400", 0.359],
  ["--color-primary-500", 0.453],
  ["--color-primary-600", 0.547],
  ["--color-primary-700", 0.647],
  ["--color-primary-800", 0.865],
  ["--color-primary-900", 0.956],
  ["--color-primary-950", 1],
];

/**
 * Applies `contrast` to one step, given its share of the foreground. Steps
 * within a quarter of the background — hover fills, borders, cards — never
 * move; steps past three quarters move the full amount; a smoothstep joins
 * the two. So a low-contrast palette can be made readable without its hover
 * fills turning into slabs.
 */
function liftTextSteps(share: number, contrast: number): number {
  const u = Math.min(1, Math.max(0, (share - 0.25) / 0.5));
  const weight = u * u * (3 - 2 * u);
  return share + Math.min(1, Math.max(0, contrast)) * (1 - share) * weight;
}

/**
 * Text on an accent fill: white, or the palette's darker end when that reads
 * better — a light accent like Tokyo Night's blue wants dark ink.
 */
function accentForeground(
  accent: string,
  { background, foreground }: ThemePalette,
): string {
  const ink =
    oklabLightness(background) < oklabLightness(foreground)
      ? background
      : foreground;
  return contrastRatio(accent, "#ffffff") >= contrastRatio(accent, ink)
    ? "#ffffff"
    : ink;
}

/**
 * The window frame (behind the sidebar and around the content) sits a step
 * below the background, the way editor themes do their sidebars.
 */
const FRAME_LIGHTNESS_SHIFT = -0.025;

/** The accent tokens, inked against `palette`. */
function accentTokens(
  accent: string,
  palette: ThemePalette,
): Record<string, string> {
  return {
    "--color-accent": accent,
    "--color-accent-foreground": accentForeground(accent, palette),
    "--glass-fill-submit": `color-mix(in oklab, ${accent} 90%, transparent)`,
    "--glass-hover-submit": shiftLightness(accent, -0.05),
  };
}

/** Every CSS custom property a palette sets, for one appearance. */
export function deriveThemeTokens(
  palette: ThemePalette,
  appearance: ThemeAppearance,
): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const [name, position] of SCALE_STEPS) {
    const share = appearance === "light" ? position : 1 - position;
    tokens[name] = mixOklab(
      palette.background,
      palette.foreground,
      liftTextSteps(share, palette.contrast),
    );
  }
  tokens["--app-frame"] = shiftLightness(
    palette.background,
    FRAME_LIGHTNESS_SHIFT,
  );
  return { ...tokens, ...accentTokens(palette.accent, palette) };
}

/**
 * What one resolved appearance sets: the palette's tokens with the accent
 * swapped in, the accent tokens alone over the stock scale, or nothing.
 */
function appearanceTokens(
  { palette, accent }: ResolvedAppearance,
  appearance: ThemeAppearance,
): Record<string, string> | null {
  if (palette) {
    const tokens = deriveThemeTokens(palette, appearance);
    return accent ? { ...tokens, ...accentTokens(accent, palette) } : tokens;
  }
  return accent ? accentTokens(accent, STOCK_PALETTES[appearance]) : null;
}

/** The frame an appearance paints, opaque — for theme previews. */
export function themeFrameColor(
  { palette }: ResolvedAppearance,
  appearance: ThemeAppearance,
): string {
  return palette
    ? shiftLightness(palette.background, FRAME_LIGHTNESS_SHIFT)
    : STOCK_FRAMES[appearance];
}

/**
 * The stylesheet for a resolved theme; empty when both appearances are stock.
 * `html:not(.dark)` / `html.dark` out-rank both the `@theme` layer and the
 * unlayered `:root` / `.dark` token blocks in index.css, and keep the
 * light/dark switch a pure class toggle — nothing re-renders when the mode
 * flips.
 */
export function renderAppThemeCss(theme: ResolvedAppTheme): string {
  const blocks: string[] = [];
  for (const [appearance, selector] of [
    ["light", "html:not(.dark)"],
    ["dark", "html.dark"],
  ] as const) {
    const tokens = appearanceTokens(theme[appearance], appearance);
    if (!tokens) continue;
    blocks.push(
      `${selector} {\n${Object.entries(tokens)
        .map(([name, value]) => `  ${name}: ${value};`)
        .join("\n")}\n}`,
    );
  }
  return blocks.join("\n");
}

const STYLE_ELEMENT_ID = "mains-app-theme";

/** Writes the theme's stylesheet into `<head>`, or removes it for stock. */
export function applyAppTheme(doc: Document, theme: ResolvedAppTheme): void {
  const css = renderAppThemeCss(theme);
  let style = doc.getElementById(STYLE_ELEMENT_ID);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}
