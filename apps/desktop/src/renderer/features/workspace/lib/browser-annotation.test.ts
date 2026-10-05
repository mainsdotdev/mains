// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { browserAnnotationPrompt, browserAnnotationTheme } from "./browser-annotation";
import type { ContextBrowserItem } from "./composer-context";

const selection: ContextBrowserItem = {
  kind: "browser", id: "one", url: "https://example.com", title: "Page", selector: "main", tagName: "main", text: "Hello", styles: {},
  rect: { x: 0, y: 0, width: 100, height: 100 }, pageRect: { x: 0, y: 0, width: 100, height: 100 },
  scroll: { x: 0, y: 0 }, viewport: { width: 1000, height: 800 }, devicePixelRatio: 1, timestamp: "now", screenshotMimeType: "image/png",
};

describe("browser annotations", () => {
  it("uses only annotation comments as the fallback message, preserving group order", () => {
    expect(browserAnnotationPrompt([selection])).toBe("");
    expect(browserAnnotationPrompt([
      { ...selection, elements: [selection], comment: "  First request  " },
      { ...selection, id: "two", elements: [selection], comment: "Second request" },
    ])).toBe("First request\n\nSecond request");
    expect(browserAnnotationPrompt([{ ...selection, elements: [selection] }])).toBe("Review the attached browser annotations.");
  });

  it("takes the guest editor's colors and glass paints from the active host theme", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    root.style.setProperty("--color-primary-900", "Canvas");
    root.style.setProperty("--color-primary-100", "CanvasText");
    root.style.setProperty("--color-accent", "Highlight");
    const computedStyle = getComputedStyle;
    const readStyle = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (pseudo) return { background: (element as HTMLElement).style.getPropertyValue("--glass-outline-rim")
        ? "radial-gradient(Highlight, transparent)" : "radial-gradient(GrayText, transparent)" } as CSSStyleDeclaration;
      if (element.classList.contains("glass-input")) return { background: "linear-gradient(Canvas, Canvas) padding-box" } as CSSStyleDeclaration;
      return computedStyle(element);
    });
    try {
      expect(browserAnnotationTheme()).toMatchObject({
        surface: "Canvas", foreground: "CanvasText", accent: "Highlight",
        glass: {
          outline: "radial-gradient(GrayText, transparent)",
          selectionOutline: "radial-gradient(Highlight, transparent)",
          input: "linear-gradient(Canvas, Canvas) padding-box",
        },
      });
      expect(root.querySelector(".glass-input")).toBeNull();
    } finally {
      readStyle.mockRestore();
      root.classList.remove("dark");
      root.removeAttribute("style");
    }
  });
});
