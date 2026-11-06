// @vitest-environment jsdom
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { describePresentationTarget, indexPresentationElements } from "./presentation-selection";

function bounds(node: Element, x: number, y: number, width: number, height: number) {
  node.getBoundingClientRect = () => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) });
}

async function deck() {
  const zip = new JSZip();
  zip.file("ppt/presentation.xml", `<p:presentation xmlns:p="p" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst><p:sldSz cx="1000" cy="600"/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide9.xml"/></Relationships>`);
  for (const part of ["slide1", "slide9"]) zip.file(`ppt/slides/${part}.xml`, `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="42" name="Procedure"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="60"/><a:ext cx="400" cy="300"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>First item</a:t></a:r><a:r><a:t> and second</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

function rendered() {
  const root = document.createElement("div");
  root.innerHTML = `<div class="pptx-preview-slide-wrapper"><div class="slide-wrapper"><div class="shape-wrapper"><span>First item</span><span> and second</span></div><div><div><img /></div></div><div class="group"><div class="shape-wrapper"><span>Nested</span></div></div></div></div>`;
  document.body.append(root);
  const slide = root.firstElementChild as HTMLElement;
  const text = root.querySelector<HTMLElement>(".shape-wrapper")!;
  const image = text.nextElementSibling as HTMLElement;
  const nested = root.querySelector<HTMLElement>(".group > div")!;
  bounds(slide, 20, 30, 1000, 600); bounds(text, 120, 90, 400, 300);
  bounds(image, 520, 90, 0, 0); bounds(image.firstElementChild!, 520, 90, 300, 300);
  bounds(nested, 50, 450, 200, 60);
  return { root, slide, text, image, nested };
}
afterEach(() => document.body.replaceChildren());

describe("presentation object selection", () => {
  it("groups text runs, follows slide order, and preserves the source shape identity", async () => {
    const { root, text, image, nested } = rendered();
    const targets = await indexPresentationElements(await deck(), root);
    expect(targets.size).toBe(3);
    expect(targets.has(text.querySelector("span")!)).toBe(false);
    expect(targets.get(text)?.element).toMatchObject({ text: "First item and second", shapeId: "42", sourcePart: "ppt/slides/slide9.xml", name: "Procedure" });
    expect(targets.get(image)?.element.type).toBe("image");
    expect(targets.get(nested)?.element.text).toBe("Nested");
  });
  it("keeps coordinates independent of zoom and uses the visible image crop", async () => {
    const { root, slide, text, image } = rendered();
    const targets = await indexPresentationElements(await deck(), root);
    const before = describePresentationTarget(targets.get(text)!).rect;
    bounds(slide, 10, 15, 500, 300); bounds(text, 60, 45, 200, 150);
    expect(describePresentationTarget(targets.get(text)!).rect).toEqual(before);
    bounds(slide, 20, 30, 1000, 600);
    expect(describePresentationTarget(targets.get(image)!).rect).toEqual({ x: 0.5, y: 0.1, width: 0.3, height: 0.5 });
  });
  it("retains targets for initially hidden tabs and degrades to DOM selection without source metadata", async () => {
    const { root, slide, text } = rendered();
    bounds(slide, 0, 0, 0, 0); bounds(text, 0, 0, 0, 0);
    const targets = await indexPresentationElements(new ArrayBuffer(0), root);
    expect(targets.has(text)).toBe(true);
    bounds(slide, 0, 0, 1000, 600); bounds(text, 100, 60, 400, 300);
    expect(describePresentationTarget(targets.get(text)!).rect).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.5 });
    expect(targets.get(text)?.element.shapeId).toBeUndefined();
  });
});
