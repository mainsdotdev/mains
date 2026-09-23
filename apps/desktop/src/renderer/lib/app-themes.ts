import {
  contrastRatio,
  isHexColor,
  mixOklab,
  oklabLightness,
  shiftLightness,
} from "./color";
import { APP_THEME_PRESETS, DEFAULT_APP_THEME_ID } from "./app-theme-presets";

/**
 * App themes — Settings › Appearance.
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
 * default choice and per-provider overrides (`AppThemeSettings`). Each
 * appearance's choice is a preset plus the user's edits on top — background,
 * foreground, contrast, the accent (the theme's or the user's own), and
 * whether the frame is translucent.
 */

export type ThemeAppearance = "light" | "dark";

export interface ThemePalette {
  /** Content background, `#rrggbb`. The window frame is derived from it. */
  readonly background: string;
  /** Primary text, `#rrggbb`. */
  readonly foreground: string;
  /** Links, focus accents, selection, `#rrggbb`. */
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

// The presets are data; they live beside this file.
export { APP_THEME_PRESETS, DEFAULT_APP_THEME_ID } from "./app-theme-presets";

/** The themes that offer something for `appearance`, in menu order. */
export function appThemesFor(appearance: ThemeAppearance): AppThemePreset[] {
  return APP_THEME_PRESETS.filter((preset) => appearance in preset.palettes);
}

/** A preset's palette for `appearance`; `null` for stock or when it has none. */
function presetPalette(
  id: string,
  appearance: ThemeAppearance,
): ThemePalette | null {
  return (
    APP_THEME_PRESETS.find((preset) => preset.id === id)?.palettes[
      appearance
    ] ?? null
  );
}

/**
 * The stock scale as a palette: index.css's content backgrounds, scale ends
 * and accent. A stock appearance derives nothing from it until one of its
 * colours is edited; a custom accent on stock is inked against it meanwhile.
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

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

/**
 * Where an appearance's accent comes from: the theme, or the user's own
 * (`AppearanceChoice.accentColor`).
 */
export type ThemeAccentSource = "theme" | "custom";

/** One appearance's pick: a preset, and the user's edits on top of it. */
export interface AppearanceChoice {
  readonly theme: string;
  readonly accent: ThemeAccentSource;
  /**
   * The custom accent, `#rrggbb`. Kept while another source is picked, so
   * switching back to "custom" brings it back.
   */
  readonly accentColor?: string;
  /** Edits of the preset's palette; unset keeps the preset's value. */
  readonly background?: string;
  readonly foreground?: string;
  readonly contrast?: number;
  /**
   * Whether the frame lets the macOS vibrancy through. Unset follows the
   * preset: stock is translucent, every palette theme opaque.
   */
  readonly translucent?: boolean;
}

export interface ThemeChoice {
  readonly light: AppearanceChoice;
  readonly dark: AppearanceChoice;
}

/**
 * Settings › Appearance. `default` applies to every provider; a provider's
 * entry replaces it one appearance at a time. An appearance the entry lacks
 * follows the default, so editing the default moves every provider that
 * didn't take that appearance over.
 */
export interface AppThemeSettings {
  readonly default: ThemeChoice;
  readonly providers: Readonly<Record<string, Partial<ThemeChoice>>>;
}

const STOCK_CHOICE: AppearanceChoice = {
  theme: DEFAULT_APP_THEME_ID,
  accent: "theme",
};

export const DEFAULT_APP_THEME_SETTINGS: AppThemeSettings = {
  default: { light: STOCK_CHOICE, dark: STOCK_CHOICE },
  providers: {},
};

const APPEARANCES: readonly ThemeAppearance[] = ["light", "dark"];

const isAccentSource = (value: unknown): value is ThemeAccentSource =>
  value === "theme" || value === "custom";

/**
 * An earlier release could take the accent from the active provider's brand
 * colour (`"provider"`); that choice reads as the theme's accent now.
 */
const readAccentSource = (value: unknown): ThemeAccentSource | null =>
  value === "provider" ? "theme" : isAccentSource(value) ? value : null;

/** A persisted appearance choice with malformed fields dropped; `null` if it isn't one. */
function parseAppearanceChoice(value: unknown): AppearanceChoice | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const accent = readAccentSource(raw.accent);
  if (typeof raw.theme !== "string" || !accent) return null;
  const choice: {
    -readonly [K in keyof AppearanceChoice]: AppearanceChoice[K];
  } = { theme: raw.theme, accent };
  if (isHexColor(raw.accentColor)) choice.accentColor = raw.accentColor;
  if (isHexColor(raw.background)) choice.background = raw.background;
  if (isHexColor(raw.foreground)) choice.foreground = raw.foreground;
  if (typeof raw.contrast === "number" && Number.isFinite(raw.contrast)) {
    choice.contrast = clamp01(raw.contrast);
  }
  if (typeof raw.translucent === "boolean") choice.translucent = raw.translucent;
  return choice;
}

/**
 * One scope's persisted entry. The first release stored a bare theme id per
 * appearance (`{ light: "gruvbox" }`), beside an accent source that meant
 * the provider's brand colour or the theme's; the ids read as appearance
 * choices with no edits, and the accent as the theme's.
 */
function parseScope(value: unknown): Partial<ThemeChoice> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const scope: { -readonly [K in ThemeAppearance]?: AppearanceChoice } = {};
  for (const appearance of APPEARANCES) {
    const entry = raw[appearance];
    if (typeof entry === "string") {
      scope[appearance] = { theme: entry, accent: "theme" };
    } else if (entry !== undefined) {
      const choice = parseAppearanceChoice(entry);
      if (choice) scope[appearance] = choice;
    }
  }
  return scope;
}

/**
 * The persisted settings, whichever release wrote them; anything unreadable
 * becomes the default. Both the redux-persist migration and the pre-paint
 * read go through here, so neither ever holds a shape the rest can't read.
 */
export function parseAppThemeSettings(value: unknown): AppThemeSettings {
  if (!value || typeof value !== "object") return DEFAULT_APP_THEME_SETTINGS;
  const { default: rawDefault, providers: rawProviders } = value as Record<
    string,
    unknown
  >;
  const base = parseScope(rawDefault);
  const defaults: ThemeChoice = {
    light: base.light ?? STOCK_CHOICE,
    dark: base.dark ?? STOCK_CHOICE,
  };
  const providers: Record<string, Partial<ThemeChoice>> = {};
  if (rawProviders && typeof rawProviders === "object") {
    for (const [id, entry] of Object.entries(rawProviders)) {
      const scope = parseScope(entry);
      if (Object.keys(scope).length > 0) providers[id] = scope;
    }
  }
  return { default: defaults, providers };
}

/** The picks in force for `providerId` — `null` before it is known. */
export function themeChoiceFor(
  settings: AppThemeSettings,
  providerId: string | null,
): ThemeChoice {
  const override = providerId ? settings.providers[providerId] : undefined;
  return { ...settings.default, ...override };
}

/**
 * One edit from the settings page: an appearance's whole choice for a scope
 * (`providerId: null` is the default). `choice: null` hands a provider's
 * appearance back to the default.
 */
export interface ThemeChoiceChange {
  readonly providerId: string | null;
  readonly appearance: ThemeAppearance;
  readonly choice: AppearanceChoice | null;
}

/**
 * Applies a change; a provider's entry goes away once it overrides nothing.
 * The default has nothing to fall back to, so a null there is ignored.
 */
export function applyThemeChoice(
  settings: AppThemeSettings,
  { providerId, appearance, choice }: ThemeChoiceChange,
): AppThemeSettings {
  if (providerId === null) {
    if (!choice) return settings;
    return {
      ...settings,
      default: { ...settings.default, [appearance]: choice },
    };
  }
  const { [appearance]: _replaced, ...kept } =
    settings.providers[providerId] ?? {};
  const override = choice ? { ...kept, [appearance]: choice } : kept;
  const { [providerId]: _previous, ...others } = settings.providers;
  return {
    ...settings,
    providers:
      Object.keys(override).length > 0
        ? { ...others, [providerId]: override }
        : others,
  };
}

/**
 * The choice with `patch` applied, and edits that went back to `undefined`
 * dropped rather than stored as holes.
 */
export function editAppearanceChoice(
  choice: AppearanceChoice,
  patch: Partial<AppearanceChoice>,
): AppearanceChoice {
  const next: Record<string, unknown> = { ...choice, ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === undefined) delete next[key];
  }
  return next as unknown as AppearanceChoice;
}

// ─────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────

/** WCAG AA for text: `text-accent` sets copy in the accent. */
const ACCENT_MIN_CONTRAST = 4.5;

/**
 * A theme accent made readable on `background`: moved in OKLab lightness,
 * away from the background, until it reaches AA — hue and chroma kept, so
 * Solarized's yellow stays yellow. An editor palette's accent rarely sets body
 * text, but `text-accent` does. A custom accent is the user's call and is
 * painted as picked.
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

/**
 * The palette an appearance choice derives its scale from: the preset's,
 * with the user's edits. Stock stays `null` — index.css untouched — until one
 * of its colours is edited; then the edits apply to the stock palette.
 */
function choicePalette(
  choice: AppearanceChoice,
  appearance: ThemeAppearance,
): ThemePalette | null {
  const edited =
    choice.background !== undefined ||
    choice.foreground !== undefined ||
    choice.contrast !== undefined;
  const base =
    presetPalette(choice.theme, appearance) ??
    (edited ? STOCK_PALETTES[appearance] : null);
  if (!base) return null;
  const background = choice.background ?? base.background;
  return {
    background,
    foreground: choice.foreground ?? base.foreground,
    accent: fitAccent(base.accent, background),
    contrast: choice.contrast ?? base.contrast,
  };
}

/** One appearance, resolved. */
export interface ResolvedAppearance {
  /** What the scale derives from; `null` is the stock scale. */
  readonly palette: ThemePalette | null;
  /** An accent over the palette's (or stock's) own; `null` keeps that one. */
  readonly accent: string | null;
  /** Whether the frame lets the vibrancy through. */
  readonly translucent: boolean;
}

export interface ResolvedAppTheme {
  readonly light: ResolvedAppearance;
  readonly dark: ResolvedAppearance;
}

export function resolveAppearance(
  choice: AppearanceChoice,
  appearance: ThemeAppearance,
): ResolvedAppearance {
  return {
    palette: choicePalette(choice, appearance),
    accent:
      choice.accent === "custom" && choice.accentColor
        ? choice.accentColor
        : null,
    translucent:
      choice.translucent ?? presetPalette(choice.theme, appearance) === null,
  };
}

/**
 * An id that is unknown (a preset since removed) or not offered for that
 * appearance falls back to stock rather than failing.
 */
export function resolveAppTheme(choice: ThemeChoice): ResolvedAppTheme {
  return {
    light: resolveAppearance(choice.light, "light"),
    dark: resolveAppearance(choice.dark, "dark"),
  };
}

/**
 * The colours an appearance actually paints — its palette (stock's when it
 * has none) with the resolved accent. What the settings editor shows.
 */
export function paintedPalette(
  { palette, accent }: ResolvedAppearance,
  appearance: ThemeAppearance,
): ThemePalette {
  const base = palette ?? STOCK_PALETTES[appearance];
  return { ...base, accent: accent ?? base.accent };
}

// ─────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────

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
  const u = clamp01((share - 0.25) / 0.5);
  const weight = u * u * (3 - 2 * u);
  return share + clamp01(contrast) * (1 - share) * weight;
}

/**
 * Text on an accent fill: white, or the palette's darker end when that reads
 * better — a light accent like Tokyo Night's blue wants dark ink. A fitted
 * accent always clears AA with one of the two; a custom one may not, and
 * falls back to whichever of white and black reads better.
 */
function accentForeground(
  accent: string,
  { background, foreground }: ThemePalette,
): string {
  const ink =
    oklabLightness(background) < oklabLightness(foreground)
      ? background
      : foreground;
  const best =
    contrastRatio(accent, "#ffffff") >= contrastRatio(accent, ink)
      ? "#ffffff"
      : ink;
  if (contrastRatio(accent, best) >= ACCENT_MIN_CONTRAST) return best;
  return contrastRatio(accent, "#ffffff") >= contrastRatio(accent, "#000000")
    ? "#ffffff"
    : "#000000";
}

/**
 * The window frame (behind the sidebar and around the content) sits a step
 * below the background, the way editor themes do their sidebars.
 */
const FRAME_LIGHTNESS_SHIFT = -0.025;

/**
 * How much of a translucent themed frame is paint; the rest is vibrancy.
 * Stock keeps its own, lighter mix from index.css.
 */
const TRANSLUCENT_FRAME_OPACITY = 80;

/** The accent tokens, inked against `palette`. */
function accentTokens(
  accent: string,
  palette: ThemePalette,
): Record<string, string> {
  return {
    "--color-accent": accent,
    "--color-accent-foreground": accentForeground(accent, palette),
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
 * What one resolved appearance sets, or `null` for pure stock: the palette's
 * tokens, the accent over them (or over the stock scale), and the frame when
 * its translucency differs from what the rest already paints.
 */
function appearanceTokens(
  { palette, accent, translucent }: ResolvedAppearance,
  appearance: ThemeAppearance,
): Record<string, string> | null {
  const tokens = palette ? deriveThemeTokens(palette, appearance) : {};
  if (accent) {
    Object.assign(
      tokens,
      accentTokens(accent, palette ?? STOCK_PALETTES[appearance]),
    );
  }
  if (palette && translucent) {
    tokens["--app-frame"] =
      `color-mix(in srgb, ${tokens["--app-frame"]} ${TRANSLUCENT_FRAME_OPACITY}%, transparent)`;
  } else if (!palette && !translucent) {
    tokens["--app-frame"] = shiftLightness(
      STOCK_PALETTES[appearance].background,
      FRAME_LIGHTNESS_SHIFT,
    );
  }
  return Object.keys(tokens).length > 0 ? tokens : null;
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
