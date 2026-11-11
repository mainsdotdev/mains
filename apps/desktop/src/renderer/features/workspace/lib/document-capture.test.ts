// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureDocumentPage } from "./document-capture";

const element = { id: "text-1", type: "text" as const, name: "Selected text", text: "Passage", rect: { x: 0.25, y: 0.2, width: 0.4, height: 0.1 } };
const drawImage = vi.fn(); const strokeRect = vi.fn(); const sources: string[] = [];
beforeEach(() => {
  sources.length = 0; drawImage.mockReset(); strokeRect.mockReset();
  vi.stubGlobal("Image", class { src = ""; async decode() { sources.push(this.src); } });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, strokeRect } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,cGl4ZWxz");
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("shared document capture", () => {
  it("freezes the selected page before waiting for fonts or document replacement", async () => {
    let ready!: () => void;
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((resolve) => { ready = resolve; }) } });
    const page = document.createElement("div"); page.style.width = "800px"; page.style.height = "600px";
    page.innerHTML = "<p>Original selected passage</p>"; document.body.append(page);
    const capturing = captureDocumentPage(page, [element], "pptx");
    page.innerHTML = "<p>Replacement document</p>"; page.remove();
    ready(); await capturing;
    const svg = decodeURIComponent(sources[0].split(",").slice(1).join(","));
    expect(svg).toContain("Original selected passage");
    expect(svg).not.toContain("Replacement document");
  });
  it("uses DOCX paper dimensions in CSS pixels and retains generated list styles", async () => {
    const host = document.createElement("div"); document.body.append(host); const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style"); style.textContent = '.docx p::before { content: "•"; }'; shadow.append(style);
    const page = document.createElement("section"); page.className = "docx"; page.style.width = "612pt"; page.style.height = "792pt";
    page.innerHTML = "<p>Passage</p>"; shadow.append(page);
    Object.defineProperties(page, { offsetWidth: { value: 816 }, offsetHeight: { value: 1056 } });
    expect(await captureDocumentPage(page, [element], "docx")).toBe("cGl4ZWxz");
    const svg = new DOMParser().parseFromString(decodeURIComponent(sources[0].split(",").slice(1).join(",")), "image/svg+xml");
    expect(svg.documentElement.getAttribute("width")).toBe("816");
    expect(svg.documentElement.getAttribute("height")).toBe("1056");
    expect(svg.querySelector("rect")?.getAttribute("x")).toBe("204");
    expect(svg.querySelector("style")?.textContent).toContain('content: "•"');
  });
  it("captures PDF pixels directly and draws each selected line at bounded resolution", async () => {
    const page = document.createElement("div"); const canvas = document.createElement("canvas"); canvas.width = 2000; canvas.height = 3000; page.append(canvas);
    const rects = [{ x: 0.1, y: 0.2, width: 0.4, height: 0.02 }, { x: 0.1, y: 0.25, width: 0.3, height: 0.02 }];
    await captureDocumentPage(page, [{ ...element, rects }], "pdf");
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 960, 1440);
    expect(strokeRect).toHaveBeenCalledTimes(2);
    expect(strokeRect).toHaveBeenNthCalledWith(1, 96, 288, 384, 28.8);
    expect(sources).toEqual([]);
  });
  it("rejects an evicted PDF canvas so feedback cannot carry an empty screenshot", async () => {
    await expect(captureDocumentPage(document.createElement("div"), [element], "pdf")).rejects.toThrow("Scroll the selected page into view");
  });
});
