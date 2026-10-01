import { useEffect } from "react";

/**
 * The browser panel is a native Electron `WebContentsView`, which always paints
 * above DOM content regardless of z-index. Any full-window DOM overlay (modal,
 * preview, alert) would otherwise render *behind* it. While `active` is true this
 * hides the native view so the overlay shows on top, then restores it on close.
 *
 * Ref-counted across all callers, so the view is only restored once the last
 * overlay closes — nested/stacked overlays won't prematurely reveal the browser.
 * `setVisible` is a no-op in the main process when no browser view exists, so this
 * is safe to call unconditionally even when the browser panel is closed.
 */
let suppressors = 0;

function browserApi(): { setVisible?: (visible: boolean) => unknown } | null {
  return (window as any).api?.browser ?? null;
}

function setBrowserChatOverlayInteractive(interactive: boolean): void {
  if (!new URLSearchParams(window.location.search).has("browserChatOverlay")) return;
  // The ignored native child cannot discover pointer entry into a body-level
  // modal outside the chat card, so keep its whole window hittable meanwhile.
  void window.api?.browserChat?.setOverlayInteractive?.(interactive);
}

export function useSuppressBrowserView(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    suppressors += 1;
    if (suppressors === 1) {
      setBrowserChatOverlayInteractive(true);
      browserApi()?.setVisible?.(false);
    }
    return () => {
      suppressors -= 1;
      if (suppressors === 0) {
        setBrowserChatOverlayInteractive(false);
        browserApi()?.setVisible?.(true);
      }
    };
  }, [active]);
}
