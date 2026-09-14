const ROUTES_WITHOUT_RIGHT_PANEL = ["/settings", "/plugins", "/pulse", "/relay", "/tasks"];

export function shouldHideRightPanel(pathname: string): boolean {
  return ROUTES_WITHOUT_RIGHT_PANEL.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * How long the sidebar / right-panel slide takes, in ms. The panels animate via
 * a Tailwind `duration-150` class, which can't read this constant — so any
 * change here must be mirrored in `sidebar.tsx`, `panel.tsx`, and the
 * `content-inset` utility in `index.css`. JS timers that unmount a panel derive
 * from this value so they never fire mid-transition.
 *
 * Everything that moves when a panel toggles must land on this one clock —
 * a panel edge is usually the sum of several offsets (content margin + header
 * padding + a local inset), and mismatched durations make the pieces race each
 * other and settle at different times.
 */
export const LAYOUT_PANEL_ANIM_MS = 150;

/**
 * Layout widths are driven at runtime through these CSS custom properties
 * (see `index.css` for the static fallbacks). Persisted values live in the
 * `appSettings` redux slice and are mirrored onto `:root` by
 * `useLayoutWidthVars`. Widths are stored as plain pixel numbers.
 */
export const SIDEBAR_WIDTH_VAR = "--sidebar-width";
export const PANEL_WIDTH_VAR = "--panel-width";

export const SIDEBAR_WIDTH_DEFAULT = 288; // 18rem
export const SIDEBAR_WIDTH_MIN = 244;
export const SIDEBAR_WIDTH_MAX = 420;

export const PANEL_WIDTH_DEFAULT = 352; // 22rem
export const PANEL_WIDTH_MIN = 300;
export const PANEL_WIDTH_MAX = 500;

export const BROWSER_PANEL_WIDTH_VAR = "--browser-panel-width";
export const BROWSER_PANEL_WIDTH_DEFAULT = 608; // 38rem
export const BROWSER_PANEL_WIDTH_MIN = 420;
export const BROWSER_PANEL_WIDTH_MAX = 960;

/**
 * Gap left on either side of the session panel — between it and whatever panel
 * owns the right edge, and between it and the content it pushes left. Shared so
 * the panel's `right` offset and the content margin that reserves its column
 * can't drift apart. Its width is fixed (`--session-panel-width`, not resizable).
 */
export const SESSION_PANEL_GUTTER = "0.4375rem";

/**
 * Fixed height of the bottom terminal drawer. Shared between the drawer itself
 * and the corner-anchored subagent box, which lifts above the terminal when it
 * opens — one constant so the two can't drift apart.
 */
export const BOTTOM_TERMINAL_HEIGHT = "15.5rem";

/**
 * The content column's live left/right edges, published on `:root` by
 * `AppContent` (sidebar, right-lane panel, and docked session box all fold in).
 * Viewport-fixed overlays that should center over the *content* rather than
 * the window (the `Toaster`) consume these with a `0px` fallback, paired with
 * a `LAYOUT_PANEL_ANIM_MS` transition so they track the panel slide.
 */
export const CONTENT_LEFT_VAR = "--content-left";
export const CONTENT_RIGHT_VAR = "--content-right";

export const TASKS_DETAIL_WIDTH_DEFAULT = 640; // 40rem
export const TASKS_DETAIL_WIDTH_MIN = 440;
export const TASKS_DETAIL_WIDTH_MAX = 1100;

export const DOC_VIEWER_PANEL_WIDTH_VAR = "--doc-viewer-panel-width";
export const DOC_VIEWER_PANEL_WIDTH_DEFAULT = 720; // 45rem
export const DOC_VIEWER_PANEL_WIDTH_MIN = 480;
export const DOC_VIEWER_PANEL_WIDTH_MAX = 1100;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
