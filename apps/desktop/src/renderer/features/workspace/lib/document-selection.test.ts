// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeDocumentTarget, documentRegionTarget, documentTargetRects, documentTextTarget, docxAnnotationSurface, observeDocumentSelection, type DocumentAnnotationSurface } from "./document-selection";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) });
function fixture() {
  const root = document.createElement("div");
  root.innerHTML = `<section class="docx"><p>Before selected text after</p><table><tbody><tr><td><p>Cell text</p></td></tr></tbody></table><p><img /></p></section><section class="docx"><p>Second page</p></section>`;
  document.body.append(root);
  const page = root.querySelector<HTMLElement>("section")!;
  page.getBoundingClientRect = () => box(20, 30, 1000, 600);
  root.getBoundingClientRect = () => box(0, 0, 1040, 700);
  const surface = docxAnnotationSurface(root, root);
  return { root, page, surface, text: page.querySelector("p")!.firstChild! };
}
afterEach(() => { document.getSelection()?.removeAllRanges(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("document selection", () => {
  it("preserves exact partial text, context and separate line boxes across zoom", () => {
    const { surface, page, text } = fixture();
    const range = document.createRange(); range.setStart(text, 7); range.setEnd(text, 20);
    range.getClientRects = () => [box(120, 90, 150, 20), box(120, 115, 100, 20)] as unknown as DOMRectList;
    const target = documentTextTarget(surface, range)!;
    expect(target.element.text).toBe("selected text");
    expect(target.element.textAnchor).toEqual({ startOffset: 7, endOffset: 20, before: "Before ", after: " afterCell text" });
    expect(target.fixedRects).toHaveLength(2);
    const before = describeDocumentTarget(target);
    page.getBoundingClientRect = () => box(10, 15, 500, 300);
    expect(describeDocumentTarget(target)).toEqual(before);
    expect(documentTargetRects(target)[0]).toEqual({ x: 0.1, y: 0.1, width: 0.15, height: 1 / 30 });
  });
  it("rejects a range crossing page boundaries rather than reporting it on the wrong page", () => {
    const { root, text, surface } = fixture();
    const range = document.createRange(); range.setStart(text, 7); range.setEnd(root.querySelectorAll("section p")[3].firstChild!, 3);
    expect(documentTextTarget(surface, range)).toBeNull();
  });
  it("clips a reverse area drag to its originating page and rejects clicks", () => {
    const { page } = fixture();
    const region = documentRegionTarget(page, 1, { x: 520, y: 330 }, { x: -100, y: -100 })!;
    expect(region.element.type).toBe("region");
    expect(region.fixedRects).toEqual([{ x: 0, y: 0, width: 0.5, height: 0.5 }]);
    expect(documentRegionTarget(page, 1, { x: 100, y: 100 }, { x: 102, y: 101 })).toBeNull();
  });
  it("selects DOCX paragraphs, tables and images without duplicating cell paragraphs", () => {
    const { surface, page } = fixture();
    expect(surface.targets.get(page.querySelector("p")!)?.element.type).toBe("text");
    expect(surface.targets.get(page.querySelector("table")!)?.element.type).toBe("table");
    expect(surface.targets.get(page.querySelector("img")!)?.element.type).toBe("image");
    expect(surface.targets.has(page.querySelector("td p")!)).toBe(false);
  });
  it("resolves PDF text runs dynamically after virtualization and preserves their geometry after replacement", () => {
    const { root, page } = fixture();
    page.replaceChildren();
    const surface: DocumentAnnotationSurface = { root, viewport: root, pages: () => [page], targets: new Map(), textSelection: true };
    const select = vi.fn();
    const dispose = observeDocumentSelection(surface, "content", { select, hover: vi.fn(), invalidRange: vi.fn() });
    const span = document.createElement("span"); span.setAttribute("data-document-text", "page-1-text-0"); span.textContent = "Dynamic PDF text"; page.append(span);
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange(); range.getClientRects = () => [box(120, 90, 200, 20)] as unknown as DOMRectList; return range;
    });
    span.click();
    expect(select).toHaveBeenCalledOnce();
    const target = select.mock.calls[0][0];
    expect(target.element.id).toBe("page-1-text-0");
    span.remove();
    expect(target.node.isConnected).toBe(true);
    expect(documentTargetRects(target)[0].width).toBe(0.2);
    dispose();
  });
  it("finishes an area drag outside the page while keeping it on the originating page", () => {
    const { surface, page } = fixture(); const select = vi.fn();
    const dispose = observeDocumentSelection(surface, "region", { select, hover: vi.fn(), invalidRange: vi.fn() });
    page.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 90 }));
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 2000, clientY: 2000 }));
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0]).toMatchObject({ pageNumber: 1, element: { type: "region" }, fixedRects: [{ x: 0.1, y: 0.1, width: 0.9, height: 0.9 }] });
    dispose();
  });
  it("ignores a native range when the mouse interaction starts in the composer", () => {
    const { surface, text } = fixture(); const select = vi.fn();
    const range = document.createRange(); range.setStart(text, 7); range.setEnd(text, 20);
    range.getClientRects = () => [box(120, 90, 200, 20)] as unknown as DOMRectList;
    document.getSelection()!.addRange(range);
    const dispose = observeDocumentSelection(surface, "content", { select, hover: vi.fn(), invalidRange: vi.fn() });
    const button = document.createElement("button"); document.body.append(button);
    button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    button.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(select).not.toHaveBeenCalled(); dispose();
  });
  it("resolves inline DOCX vector artwork as an image rather than its individual paths", () => {
    const { root } = fixture(); const page = root.querySelector("section")!;
    page.insertAdjacentHTML("beforeend", '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="50"/></svg>');
    const surface = docxAnnotationSurface(root, root); const select = vi.fn();
    const dispose = observeDocumentSelection(surface, "content", { select, hover: vi.fn(), invalidRange: vi.fn() });
    page.querySelector("rect")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(select.mock.calls[0][0]).toMatchObject({ node: page.querySelector("svg"), element: { type: "image" } });
    dispose();
  });
});
