import { useMemo, useSyncExternalStore } from "react";

/**
 * Resolved values of theme CSS variables, for renderers that can't take a
 * `var()` — xterm paints on a canvas and parses its colours itself.
 *
 * Re-reads whenever a theme change can land: the `dark` class or the inline
 * style on `<html>` changes (the fonts are published there, see
 * `lib/appearance-fonts.ts`), or `<head>` does (the app theme rewrites its
 * stylesheet there, see `lib/app-themes.ts`). Each value is the computed
 * text, `var()`s substituted — the scale and the accent are plain `#rrggbb`
 * in index.css and in a derived theme alike. Prefer a `var()` everywhere a
 * stylesheet can reach.
 */

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return () => observer.disconnect();
}

export function useThemeTokens<const T extends readonly string[]>(
  names: T,
): Record<T[number], string> {
  // A string snapshot, so an unchanged read compares equal and never
  // re-renders.
  const snapshot = useSyncExternalStore(subscribe, () => {
    const style = getComputedStyle(document.documentElement);
    return names
      .map((name) => style.getPropertyValue(name).trim())
      .join("\n");
  });
  const key = names.join("\n");
  return useMemo(() => {
    const values = snapshot.split("\n");
    return Object.fromEntries(
      key.split("\n").map((name, i) => [name, values[i] ?? ""]),
    ) as Record<T[number], string>;
  }, [snapshot, key]);
}
