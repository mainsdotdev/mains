import type { BrowserAnnotationTheme } from "../../../../shared/browser-annotation";
import type { ContextItem } from "./composer-context";

export function browserAnnotationTheme(): BrowserAnnotationTheme {
  const root = document.documentElement;
  const dark = root.classList.contains("dark");
  const style = getComputedStyle(root);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const accent = token("--color-accent", "Highlight");
  // The guest's shadow root cannot inherit our stylesheet. Resolve the real
  // utility paints here so their gradients and theme overrides stay in sync.
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none";
  probe.className = "glass-outline";
  root.appendChild(probe);
  let glass: BrowserAnnotationTheme["glass"];
  try {
    const outline = getComputedStyle(probe, "::before").background;
    probe.style.setProperty("--glass-outline-rim", accent);
    const selectionOutline = getComputedStyle(probe, "::before").background;
    probe.className = "glass-input";
    const input = getComputedStyle(probe).background;
    glass = { outline, selectionOutline, input };
  } finally {
    probe.remove();
  }
  return {
    surface: token(dark ? "--color-primary-900" : "--color-primary-100", "Canvas"),
    foreground: token(dark ? "--color-primary-100" : "--color-primary-900", "CanvasText"),
    muted: token("--color-primary-500", "GrayText"),
    border: token(dark ? "--color-primary-700" : "--color-primary-200", "GrayText"),
    accent,
    accentForeground: token("--color-accent-foreground", "HighlightText"),
    fontFamily: token("--font-sans", "system-ui, sans-serif"),
    glass,
  };
}

/** An annotation's comment can be sent without typing a second prompt. */
export function browserAnnotationPrompt(items: readonly ContextItem[]): string {
  const annotations = items.filter((item) => item.kind === "browser" && item.elements?.length);
  if (!annotations.length) return "";
  const comments = annotations.flatMap((item) =>
    item.kind === "browser" && item.comment?.trim() ? [item.comment.trim()] : []);
  return comments.length ? comments.join("\n\n") : "Review the attached browser annotations.";
}
