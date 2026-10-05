// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildInspectorCaptureCompleteScript,
  buildInspectorScript,
  INSPECTOR_SENTINEL,
} from "./inspector.script";

let frames: FrameRequestCallback[];
const evaluate = (script: string) => new Function(script)();
function inspector() {
  return document.querySelector("div[data-mains-inspector]")!.shadowRoot!;
}
function flushPaint() {
  for (let i = 0; i < 2; i++) frames.splice(0).forEach((callback) => callback(0));
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  document.body.innerHTML = '<main id="content"><h1 id="title">Introduction</h1><a id="link" href="/next">Guides</a></main>';
  evaluate(buildInspectorScript(true));
});
afterEach(() => {
  evaluate(buildInspectorScript(false));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser annotation inspector", () => {
  it("keeps nested and separate selections in one comment group until Add", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const navigate = vi.fn();
    document.getElementById("link")!.addEventListener("click", navigate);
    for (const id of ["content", "title", "link"]) document.getElementById(id)!.click();
    const root = inspector();
    expect(log).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(root.querySelector(".count")!.textContent).toBe("3 selected items");
    const comment = root.querySelector("textarea")!;
    comment.value = "Bunları açıkla";
    (root.querySelector(".add") as HTMLButtonElement).click();
    expect((root.querySelector(".card") as HTMLElement).hidden).toBe(true);
    expect(root.querySelector(".highlights")!.childElementCount).toBe(3);
    expect(log).not.toHaveBeenCalled();
    flushPaint();
    const payload = JSON.parse(String(log.mock.calls[0][0]).slice(INSPECTOR_SENTINEL.length));
    expect(payload.comment).toBe("Bunları açıkla");
    expect(payload.elements.map((element: { selector: string }) => element.selector)).toEqual(["#content", "#title", "#link"]);
    expect(payload.elements[0].text).toBe("IntroductionGuides");
    expect(document.documentElement.hasAttribute("data-mains-inspect")).toBe(true);
    evaluate(buildInspectorCaptureCompleteScript());
    document.getElementById("link")!.click();
    expect(root.querySelector(".count")!.textContent).toBe("1 selected item");
    expect(comment.value).toBe("");
  });

  it("toggles a selected element and removes chips without selecting the editor", () => {
    document.getElementById("title")!.click();
    document.getElementById("link")!.click();
    document.getElementById("title")!.click();
    const root = inspector();
    expect(root.querySelectorAll(".chip")).toHaveLength(1);
    (root.querySelector(".chip button") as HTMLButtonElement).click();
    expect(root.querySelectorAll(".chip")).toHaveLength(0);
    expect((root.querySelector(".card") as HTMLElement).hidden).toBe(true);
    expect(root.querySelector(".highlights")!.childElementCount).toBe(0);
  });

  it("keeps annotation control clicks from reaching the guest page", () => {
    const pageClick = vi.fn();
    document.addEventListener("click", pageClick);
    document.getElementById("title")!.click();
    (inspector().querySelector(".close") as HTMLButtonElement).click();
    document.removeEventListener("click", pageClick);
    expect(pageClick).not.toHaveBeenCalled();
  });

  it("restores the selected elements and comment after a capture failure", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    document.getElementById("title")!.click();
    const root = inspector();
    const comment = root.querySelector("textarea")!;
    comment.value = "Keep this draft";
    (root.querySelector(".add") as HTMLButtonElement).click();
    flushPaint();
    evaluate(buildInspectorCaptureCompleteScript("Capture failed"));
    expect((root.querySelector(".card") as HTMLElement).hidden).toBe(false);
    expect(root.querySelector(".help")!.textContent).toBe("Capture failed");
    expect(comment.value).toBe("Keep this draft");
    expect(root.querySelectorAll(".chip")).toHaveLength(1);
  });

  it("adds with Enter, preserves Shift+Enter and IME composition, and blocks guest shortcuts", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const shortcut = vi.fn();
    document.getElementById("title")!.click();
    const comment = inspector().querySelector("textarea")!;
    comment.addEventListener("keydown", shortcut);
    comment.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, composed: true, cancelable: true }));
    comment.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, composed: true, cancelable: true }));
    flushPaint();
    expect(log).not.toHaveBeenCalled();
    comment.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }));
    flushPaint();
    expect(log).toHaveBeenCalledOnce();
    expect(shortcut).not.toHaveBeenCalled();
  });

  it.each(["empty", "selected"])("cancels an %s annotation with Escape and restores normal page interactions", (selection) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const click = vi.fn();
    const title = document.getElementById("title")!;
    title.addEventListener("click", click);
    if (selection === "selected") title.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(log).toHaveBeenCalledWith(INSPECTOR_SENTINEL + '{"cancel":true}');
    expect(document.querySelector("[data-mains-inspector]")).toBeNull();
    expect(document.documentElement.hasAttribute("data-mains-inspect")).toBe(false);
    title.click();
    expect(click).toHaveBeenCalledOnce();
  });

  it("refreshes positions when scrolling and captures current structural coordinates", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const title = document.getElementById("title")!;
    let top = 20;
    vi.spyOn(title, "getBoundingClientRect").mockImplementation(() =>
      ({ left: 10, top, width: 100, height: 30, right: 110, bottom: top + 30 }) as DOMRect);
    title.click();
    top = 40;
    document.dispatchEvent(new Event("scroll"));
    flushPaint();
    expect((inspector().querySelector(".highlights .outline") as HTMLElement).style.top).toBe("40px");
    (inspector().querySelector(".add") as HTMLButtonElement).click();
    flushPaint();
    const payload = JSON.parse(String(log.mock.calls[0][0]).slice(INSPECTOR_SENTINEL.length));
    expect(payload.elements[0].rect.y).toBe(40);
  });
});
