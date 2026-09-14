import type { CSSProperties } from "react";
import type { BaseCodeOptions, BaseDiffOptions } from "@pierre/diffs";
import { CODE_FONT_SIZE_CSS } from "./appearance-fonts";

/**
 * Typography for every `@pierre/diffs` surface (`PatchDiff`, `File`).
 *
 * The library renders into a shadow root, so Tailwind's `text-*` utilities and
 * the `--text-*` scale in `index.css` never reach it — the size has to travel
 * in as the library's own `--diffs-font-size` custom property.
 *
 * The size defers to the Code font-size setting, which publishes the same
 * property on `:root` (see `lib/appearance-fonts.ts`). Re-declaring it here
 * would shadow that, so this indirects through `--font-size-code` instead; the
 * fallback covers the tick before the setting is applied.
 *
 * The line height has to travel with it. The library declares the two
 * independently (`line-height: var(--diffs-line-height, 20px)`) and sizes its
 * utility buttons off `1lh`, so leaving the fallback in place would pin rows at
 * 20px while the text ranges over 10–18px — cramped and clipped at the top of
 * that range, adrift at the bottom. The ratio reproduces the library's own
 * 20px at the 12px default.
 *
 * Spread onto the component's `style` prop so the diff viewer, code viewer, PR
 * diff, and the Edit/Write/ApplyPatch tool displays can't drift apart.
 */
export const DIFF_TYPOGRAPHY_STYLE = {
  "--diffs-font-size": CODE_FONT_SIZE_CSS,
  "--diffs-line-height": `calc(${CODE_FONT_SIZE_CSS} * 5 / 3)`,
  "--diffs-font-family": "ui-monospace, monospace",
} as CSSProperties;

/**
 * Baseline `options` shared by every `@pierre/diffs` surface in the app, for
 * both `File` and `PatchDiff` (the fields live on `BaseCodeOptions`, which both
 * option types extend).
 *
 * The shadow root also blocks the app background, so `unsafeCSS` repaints the
 * library's own `--diffs-bg` from our `primary` scale — that selector list is
 * long and easy to mistype, which is the main reason this lives in one place.
 * `disableFileHeader` is part of the baseline because every surface renders its
 * own header chrome; a caller that wants the library's can override it.
 *
 * Only the containers are painted. The per-line elements (`[data-line]`,
 * `[data-column-number]`) must NOT appear in that selector list: the library
 * paints them with `var(--diffs-line-bg, var(--diffs-bg))`, which is where the
 * added/removed row tint (and hover/selection blending) lives, and `unsafeCSS`
 * lands in the last cascade layer, so naming them here flattens a changed row
 * back to plain background — leaving only the word-level emphasis spans
 * colored. `--diffs-bg` is inherited from `:host`, so the tint still mixes
 * against our background.
 */
export function diffSurfaceOptions(isDarkMode: boolean): BaseCodeOptions {
  const bg = `var(--color-${isDarkMode ? "primary-950" : "primary"})`;
  return {
    theme: isDarkMode ? "pierre-dark" : "pierre-light",
    themeType: isDarkMode ? "dark" : "light",
    disableFileHeader: true,
    unsafeCSS: `:host, [data-diffs], [data-diffs-header], [data-error-wrapper], [data-code] { --diffs-bg: ${bg}; background-color: ${bg}; }`,
  };
}

/**
 * The baseline plus the layout every `PatchDiff` in the app uses: unified (never
 * split) columns that wrap rather than scroll, since diffs render inside narrow
 * panels and collapsible tool rows.
 *
 * `hunkSeparators` is omitted because `FileDiffOptions` narrows it, so the wider
 * `BaseDiffOptions` shape wouldn't be assignable to the `options` prop.
 */
export function patchDiffOptions(
  isDarkMode: boolean
): Omit<BaseDiffOptions, "hunkSeparators"> {
  return {
    ...diffSurfaceOptions(isDarkMode),
    diffStyle: "unified",
    overflow: "wrap",
  };
}
