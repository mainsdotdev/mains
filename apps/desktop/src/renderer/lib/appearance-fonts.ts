/**
 * Fonts from Settings › Appearance, applied to `:root`: two sizes, and the UI
 * and code families (further down).
 *
 * Two independent controls, because they answer different complaints:
 *
 * - **Interface** drives `root.style.fontSize`. Every `--text-*` token is
 *   authored in `rem` (see the `@theme` block in `index.css`), and `rem`
 *   resolves against the root at use time, so one property rescales all of
 *   them — and with them every other rem-based dimension, `--spacing`
 *   included. It is a UI scale, not a typography-only knob.
 * - **Code** stays in absolute pixels, published as `--font-size-code` and
 *   `--diffs-font-size`. Were it a `rem` value it would scale twice: once
 *   from the interface size and once from its own.
 */

export const MIN_INTERFACE_FONT_SIZE = 12;
export const MAX_INTERFACE_FONT_SIZE = 18;
export const DEFAULT_INTERFACE_FONT_SIZE = 16;

export const MIN_CODE_FONT_SIZE = 10;
export const MAX_CODE_FONT_SIZE = 18;
/** Matches the size every `@pierre/diffs` surface shipped with before this setting existed. */
export const DEFAULT_CODE_FONT_SIZE = 12;

/**
 * The single published hook for the Code size. `@pierre/diffs` surfaces reach
 * it through `DIFF_TYPOGRAPHY_STYLE` (see `lib/diff-style.ts`) rather than a
 * second `:root` property, so the library's `--diffs-font-size` keeps one
 * writer.
 */
export const CODE_FONT_SIZE_VAR = "--font-size-code";

/**
 * The Code size as a CSS value, for surfaces that set `font-size` themselves.
 * The fallback covers the tick before the setting is applied to `:root`.
 */
export const CODE_FONT_SIZE_CSS = `var(${CODE_FONT_SIZE_VAR}, ${DEFAULT_CODE_FONT_SIZE}px)`;

export interface AppearanceFontSizes {
  readonly interfaceFontSize: number;
  readonly codeFontSize: number;
}

function clampFontSize(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function clampInterfaceFontSize(value: number): number {
  return clampFontSize(
    value,
    MIN_INTERFACE_FONT_SIZE,
    MAX_INTERFACE_FONT_SIZE,
    DEFAULT_INTERFACE_FONT_SIZE
  );
}

export function clampCodeFontSize(value: number): number {
  return clampFontSize(
    value,
    MIN_CODE_FONT_SIZE,
    MAX_CODE_FONT_SIZE,
    DEFAULT_CODE_FONT_SIZE
  );
}

export const isFontSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Write both sizes onto the root element. Values are clamped here rather than
 * at the call sites so a corrupt persisted blob can never produce unreadable
 * text — the setting is the only way out of a bad setting.
 */
export function applyAppearanceFontSizes(
  root: HTMLElement,
  sizes: AppearanceFontSizes
): void {
  root.style.fontSize = `${clampInterfaceFontSize(sizes.interfaceFontSize)}px`;
  root.style.setProperty(
    CODE_FONT_SIZE_VAR,
    `${clampCodeFontSize(sizes.codeFontSize)}px`
  );
}

// ─────────────────────────────────────────────────────────────
// Font families
// ─────────────────────────────────────────────────────────────

/**
 * The UI and code fonts, as the CSS family that goes in front of the stock
 * stacks in index.css (`--font-sans` reads `--font-ui-family`, `--font-mono`
 * reads `--font-code-family`). `""` is the stock font: Inter, and the system
 * monospace (SF Mono). A font that isn't installed falls through to the rest
 * of the stack, never to the browser default.
 */
export interface AppearanceFontFamilies {
  readonly uiFontFamily: string;
  readonly codeFontFamily: string;
}

export const UI_FONT_FAMILY_VAR = "--font-ui-family";
export const CODE_FONT_FAMILY_VAR = "--font-code-family";

export interface FontFamilyOption {
  /** CSS family (quoted where it needs to be); `""` is the stock font. */
  readonly value: string;
  readonly label: string;
}

/** Faces every Mac has, offered before the installed-font list loads. */
export const UI_FONT_OPTIONS: readonly FontFamilyOption[] = [
  { value: "", label: "Inter" },
  { value: "-apple-system", label: "SF Pro" },
  { value: '"Helvetica Neue"', label: "Helvetica Neue" },
  { value: '"Avenir Next"', label: "Avenir Next" },
];

export const CODE_FONT_OPTIONS: readonly FontFamilyOption[] = [
  { value: "", label: "SF Mono" },
  { value: "Menlo", label: "Menlo" },
  { value: "Monaco", label: "Monaco" },
  { value: '"Courier New"', label: "Courier New" },
];

/** A family name as a CSS string, safe for any name the system reports. */
export function quoteFontFamily(name: string): string {
  return `"${name.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * A stored family is spliced into a custom property, so it is held to what a
 * single family can look like — no declaration or block punctuation.
 */
export const isFontFamily = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 200 && !/[;{}]/.test(value);

/** Publishes both families on the root element; the stock font clears its property. */
export function applyAppearanceFontFamilies(
  root: HTMLElement,
  families: AppearanceFontFamilies,
): void {
  for (const [property, family] of [
    [UI_FONT_FAMILY_VAR, families.uiFontFamily],
    [CODE_FONT_FAMILY_VAR, families.codeFontFamily],
  ] as const) {
    if (family && isFontFamily(family)) root.style.setProperty(property, family);
    else root.style.removeProperty(property);
  }
}

/**
 * The installed families, through the Local Font Access API (Chromium, so
 * the desktop app and Chrome) — sorted and deduplicated from the per-style
 * entries it returns. Empty where the API is missing or refused; callers
 * keep the curated options then. Asked once per session: the list only
 * changes when fonts are installed, and the call needs a user gesture.
 */
let installedFamilies: Promise<string[]> | null = null;

export function loadInstalledFontFamilies(): Promise<string[]> {
  const query = (
    globalThis as {
      queryLocalFonts?: () => Promise<ReadonlyArray<{ family: string }>>;
    }
  ).queryLocalFonts;
  if (!query) return Promise.resolve([]);
  installedFamilies ??= query()
    .then((fonts) =>
      [...new Set(fonts.map((font) => font.family))].sort((a, b) =>
        a.localeCompare(b),
      ),
    )
    .catch(() => {
      // Refused or failed: offer the curated faces, and ask again next time.
      installedFamilies = null;
      return [];
    });
  return installedFamilies;
}

/** Curated options, then every installed family not already among them. */
export function fontFamilyOptions(
  curated: readonly FontFamilyOption[],
  installed: readonly string[],
): FontFamilyOption[] {
  const labels = new Set(curated.map((option) => option.label));
  return [
    ...curated,
    ...installed
      .filter((family) => !labels.has(family))
      .map((family) => ({ value: quoteFontFamily(family), label: family })),
  ];
}

/** A stored family as a name to show: its curated label, else the family unquoted. */
export function fontFamilyLabel(
  family: string,
  curated: readonly FontFamilyOption[],
): string {
  return (
    curated.find((option) => option.value === family)?.label ??
    family.replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1")
  );
}
