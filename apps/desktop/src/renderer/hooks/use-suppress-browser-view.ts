import { useEffect } from "react";

/**
 * The browser panel is a native Electron `WebContentsView`, which always paints
 * above DOM content regardless of z-index. Any full-window DOM overlay (modal,
 * preview, alert) would otherwise render *behind* it. While `active` is true this
 * holds a suppression lease so the overlay shows on top, then releases it.
 *
 * Ref-counted across all callers, so the view is only restored once the last
 * overlay closes — nested/stacked overlays won't prematurely reveal the browser.
 * Main applies leases without changing whether the panel is attached or wants
 * its page visible. Closing a modal cannot reopen a closed or hidden panel.
 */
let suppressors = 0;

function browserApi(): { setSuppressed?: (lease: string, suppressed: boolean) => unknown } | null {
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
    const lease = crypto.randomUUID();
    const api = browserApi();
    api?.setSuppressed?.(lease, true);
    suppressors += 1;
    if (suppressors === 1) {
      setBrowserChatOverlayInteractive(true);
    }
    return () => {
      suppressors -= 1;
      api?.setSuppressed?.(lease, false);
      if (suppressors === 0) {
        setBrowserChatOverlayInteractive(false);
      }
    };
  }, [active]);
}
