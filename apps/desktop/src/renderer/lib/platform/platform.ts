/**
 * Single source of truth for the runtime platform. Use these instead of ad-hoc
 * `window.mainTransport` checks scattered around the codebase.
 *
 * Electron exposes `window.mainTransport` via the preload. A plain browser (the
 * renderer served by `mains serve` over HTTP) has no preload → web mode.
 *
 * NOTE: this is the *platform* axis (electron vs web → which features exist). It
 * is orthogonal to the *form-factor* axis (wide vs narrow viewport → layout); see
 * `use-breakpoint.ts` for that. A web app on a desktop is still "web" but uses
 * the desktop layout.
 */
function detectElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as { mainTransport?: unknown }).mainTransport)
  );
}

export const isElectron = detectElectron();
export const isWeb = !isElectron;
