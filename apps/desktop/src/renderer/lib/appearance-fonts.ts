/**
 * Font sizes from Settings → General → Appearance, applied to `:root`.
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
