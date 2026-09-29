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
  // The code font from Settings › Appearance (index.css `--font-mono`).
  "--diffs-font-family": "var(--font-mono)",
} as CSSProperties;

/**
 * The editor's find/replace panel (Cmd+F), restyled as one of our glass
 * popovers. The library offers no API for the panel — no render hook, no
 * option — so the only seam is CSS against its `data-*` hooks, delivered
 * through `unsafeCSS` below.
 *
 * Every declaration carries `!important`, and that is load-bearing: the
 * library's editor stylesheet is unlayered while `unsafeCSS` lands in
 * `@layer unsafe`, and an unlayered rule beats any layered one. Only a
 * layered `!important` outranks it. That includes the `--diffs-*` variables
 * the library declares itself (`--diffs-search-icon-size` on the close
 * button).
 *
 * The app's tokens (`--color-*`, `--glass-*`, `--font-sans`) are custom
 * properties set on the document root, so they inherit into the shadow root;
 * `--diffs-fg` / `--diffs-bg` are our `primary` steps (see `diffSurfaceOptions`).
 *
 * The close button leaves its stock spot — a disc straddling the panel's
 * top-right corner, which the editor's scroll edge clipped — for a grid cell
 * after the next/previous buttons.
 */
const SEARCH_PANEL_CSS = `
[data-search-panel] [data-editor-widget] {
  --search-fill: var(--glass-fill-surface);
  font: 400 12px/18px var(--font-sans) !important;
  color: var(--diffs-fg) !important;
  padding: 6px !important;
  border: 0.5px solid transparent !important;
  border-radius: 14px !important;
  background:
    linear-gradient(var(--search-fill), var(--search-fill)) padding-box,
    radial-gradient(130% 120% at 8% -10%, var(--glass-rim) 0 18%, transparent 48%) border-box,
    radial-gradient(100% 90% at 104% 100%, var(--glass-rim) 0 12%, transparent 46%) border-box,
    linear-gradient(135deg, var(--glass-rim) 0%, var(--glass-rim) 25%, transparent 47%,
      var(--glass-rim-shadow) 70%, var(--glass-rim) 88%, var(--glass-rim) 100%) border-box !important;
  box-shadow: 0 6px 20px color-mix(in srgb, var(--color-primary-950) 14%, transparent) !important;
}
[data-search-panel] [data-search-grid] {
  grid-template-columns: auto auto auto auto !important;
  gap: 4px !important;
}
[data-search-panel] [data-search-grid][data-mode="find"] {
  grid-template-areas: "find matches nav close" !important;
}
[data-search-panel] [data-search-grid][data-mode="replace"] {
  grid-template-areas: "find matches nav close" "replace actions . ." !important;
}
@container search-panel (width < 400px) {
  [data-search-panel] [data-search-grid][data-mode="find"] {
    grid-template-columns: auto 1fr auto !important;
    grid-template-areas: "find find close" "nav matches matches" !important;
  }
  [data-search-panel] [data-search-grid][data-mode="replace"] {
    grid-template-columns: auto 1fr auto !important;
    grid-template-areas: "find find close" "replace replace replace" "nav matches actions" !important;
  }
  /* Here the counter shares a wide row with the arrows — keep it beside them.
     (The grid in the selector outranks the centring rule further down.) */
  [data-search-panel] [data-search-grid] [data-matches] {
    text-align: start;
  }
}
[data-search-panel] [data-input-box] input {
  font: inherit !important;
  line-height: 26px !important;
  color: var(--diffs-fg) !important;
  background-color: var(--glass-fill-input) !important;
  border: 1px solid var(--glass-outline-rim) !important;
  border-radius: 9px !important;
  padding-inline: 8px !important;
}
[data-search-panel] [data-input-box][data-find] input {
  padding-inline-end: 72px !important;
}
[data-search-panel] [data-input-box] input::placeholder {
  color: color-mix(in srgb, var(--diffs-fg) 45%, transparent) !important;
}
[data-search-panel] [data-input-box] input:focus-visible {
  outline: none !important;
  border-color: color-mix(in srgb, var(--color-accent) 55%, transparent) !important;
}
[data-search-panel] [data-input-box] input::selection {
  background-color: color-mix(in srgb, var(--color-accent) 30%, transparent) !important;
}
[data-search-panel] [data-matches] {
  font-size: 11px !important;
  font-variant-numeric: tabular-nums;
  /* Room for "9999 of 9999": the panel is right-aligned and sized to its
     content, so a counter that grows as you type would push the input
     sideways. */
  min-width: 12ch !important;
  text-align: center;
  padding-inline: 4px;
  color: color-mix(in srgb, var(--diffs-fg) 55%, transparent) !important;
}
[data-search-panel] [data-matches][data-no-matches] {
  color: color-mix(in srgb, var(--diffs-fg) 40%, transparent) !important;
}
[data-search-panel] [data-search-icon] {
  border-radius: 7px !important;
  color: color-mix(in srgb, var(--diffs-fg) 60%, transparent) !important;
}
[data-search-panel] [data-search-icon]:not(:disabled):hover {
  color: var(--diffs-fg) !important;
  background-color: color-mix(in srgb, var(--diffs-fg) 8%, transparent) !important;
}
[data-search-panel] [data-search-icon][aria-pressed="true"] {
  color: var(--color-accent) !important;
  background-color: color-mix(in srgb, var(--color-accent) 15%, transparent) !important;
}
[data-search-panel] [data-search-icon]:focus-visible {
  outline: 1px solid var(--color-accent) !important;
}
[data-search-panel] [data-search-close] {
  grid-area: close;
  --diffs-search-icon-size: 24px !important;
  position: static !important;
  transform: none !important;
  background: none !important;
}
`;

/**
 * Baseline `options` shared by every `@pierre/diffs` surface in the app, for
 * both `File` and `PatchDiff` (the fields live on `BaseCodeOptions`, which both
 * option types extend).
 *
 * The shadow root also blocks the app background, so `unsafeCSS` repaints the
 * library's own `--diffs-bg` and `--diffs-fg` from our `primary` scale — that
 * selector list is long and easy to mistype, which is the main reason this
 * lives in one place. The library derives its context rows, separators, line
 * numbers and hover mixes from those two, so an app theme reaches all of them;
 * only syntax colours stay the pierre theme's. The stock steps sit within a
 * shade of pierre's own (`#0a0a0a` / `#fafafa`).
 * `disableFileHeader` is part of the baseline because every surface renders its
 * own header chrome; a caller that wants the library's can override it. The
 * editor's find panel restyle (`SEARCH_PANEL_CSS`) rides along, so every
 * editable surface gets the same panel.
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
  const fg = `var(--color-${isDarkMode ? "primary-100" : "primary-950"})`;
  return {
    theme: isDarkMode ? "pierre-dark" : "pierre-light",
    themeType: isDarkMode ? "dark" : "light",
    disableFileHeader: true,
    unsafeCSS: `:host, [data-diffs], [data-diffs-header], [data-error-wrapper], [data-code] { --diffs-bg: ${bg}; --diffs-fg: ${fg}; background-color: ${bg}; }${SEARCH_PANEL_CSS}`,
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
