import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Reactive read of the root `.dark` theme class — for the few places that
 * feed the theme into non-Tailwind surfaces (diff/code render libraries) and
 * would otherwise go stale when the theme is toggled mid-session.
 */
export function useIsDarkMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
