import type { PresentationElement } from "@mains/contracts/presentation-annotations";

export interface PresentationTarget {
  node: HTMLElement;
  slide: HTMLElement;
  slideNumber: number;
  element: PresentationElement;
}

interface SourceShape {
  type: PresentationElement["type"];
  name: string;
  text: string;
  shapeId: string;
  sourcePart: string;
  rect?: PresentationElement["rect"];
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();
const xmlChildren = (node: Element, name: string) => Array.from(node.children).filter((child) => child.localName === name);
const xmlFirst = (node: Element, name: string) => node.getElementsByTagNameNS("*", name)[0];

/** Follow presentation relationships: slide filenames need not be in display order. */
async function sourceShapes(buf: ArrayBuffer): Promise<SourceShape[][]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buf);
  const readXml = async (part: string) => {
    const file = zip.file(part);
    if (!file) throw new Error(`Missing presentation part: ${part}`);
    return new DOMParser().parseFromString(await file.async("string"), "application/xml");
  };
  const presentation = await readXml("ppt/presentation.xml");
  const relationships = await readXml("ppt/_rels/presentation.xml.rels");
  const size = presentation.getElementsByTagNameNS("*", "sldSz")[0];
  const width = Number(size?.getAttribute("cx"));
  const height = Number(size?.getAttribute("cy"));
  const parts = new Map(Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))
    .filter((rel) => rel.getAttribute("TargetMode") !== "External")
    .map((rel) => [rel.getAttribute("Id"), new URL(rel.getAttribute("Target") ?? "", "https://pptx.invalid/ppt/").pathname.slice(1)]));
  const result: SourceShape[][] = [];
  for (const slideId of Array.from(presentation.getElementsByTagNameNS("*", "sldId"))) {
    const part = parts.get(slideId.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id"));
    if (!part) { result.push([]); continue; }
    const doc = await readXml(part);
    const tree = doc.getElementsByTagNameNS("*", "spTree")[0];
    const shapes: SourceShape[] = [];
    const visit = (parent: Element, grouped = false) => {
      for (const node of Array.from(parent.children)) {
        if (node.localName === "grpSp") { visit(node, true); continue; }
        if (!["sp", "pic", "cxnSp", "graphicFrame"].includes(node.localName)) continue;
        const props = xmlFirst(node, "cNvPr");
        if (!props) continue;
        const text = normalizeText(Array.from(node.getElementsByTagNameNS("*", "p"), (paragraph) =>
          Array.from(paragraph.getElementsByTagNameNS("*", "t"), (run) => run.textContent).join("")).join(" "));
        const type: SourceShape["type"] = node.localName === "pic" ? "image" : xmlFirst(node, "tbl") ? "table"
          : xmlFirst(node, "chart") ? "chart" : text ? "text" : "shape";
        const transform = xmlFirst(node, "xfrm");
        const off = transform && xmlChildren(transform, "off")[0];
        const ext = transform && xmlChildren(transform, "ext")[0];
        const rect = !grouped && off && ext && width > 0 && height > 0 ? {
          x: Number(off.getAttribute("x")) / width, y: Number(off.getAttribute("y")) / height,
          width: Number(ext.getAttribute("cx")) / width, height: Number(ext.getAttribute("cy")) / height,
        } : undefined;
        shapes.push({ type, name: props.getAttribute("name") || type, text,
          shapeId: props.getAttribute("id") ?? "", sourcePart: part, rect });
      }
    };
    if (tree) visit(tree);
    result.push(shapes);
  }
  return result;
}

/** Image wrappers in pptx-preview have zero dimensions; their crop box owns the bounds. */
export function presentationTargetBounds(target: Pick<PresentationTarget, "node">): DOMRect {
  const rect = target.node.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return rect;
  return target.node.firstElementChild?.getBoundingClientRect() ?? rect;
}

export function describePresentationTarget(target: PresentationTarget): PresentationElement {
  const slide = target.slide.getBoundingClientRect();
  const rect = presentationTargetBounds(target);
  return { ...target.element, rect: {
    x: (rect.left - slide.left) / slide.width, y: (rect.top - slide.top) / slide.height,
    width: rect.width / slide.width, height: rect.height / slide.height,
  } };
}

/** Keep selection at shape boundaries, never at individual text runs or SVG paths. */
export async function indexPresentationElements(buf: ArrayBuffer, root: HTMLElement): Promise<Map<HTMLElement, PresentationTarget>> {
  // Source identities enhance selection; a deck that cannot be indexed still has DOM targets.
  const sources = await sourceShapes(buf).catch(() => []);
  const targets = new Map<HTMLElement, PresentationTarget>();
  Array.from(root.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper")).forEach((slide, slideIndex) => {
    let ordinal = 0;
    const available = [...sources[slideIndex] ?? []];
    const visit = (parent: Element, fromSlide: boolean) => {
      for (const node of Array.from(parent.children)) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains("group")) { visit(node, fromSlide); continue; }
        const text = normalizeText(node.innerText || node.textContent || "");
        const type: PresentationElement["type"] = node.querySelector("table") ? "table"
          : node.querySelector("canvas,[_echarts_instance_]") || node.hasAttribute("_echarts_instance_") ? "chart"
          : text ? "text" : node.querySelector("img") ? "image" : "shape";
        const target: PresentationTarget = { node, slide, slideNumber: slideIndex + 1, element: {
          id: `slide-${slideIndex + 1}-element-${++ordinal}`, type, name: type === "text" ? "Text box" : `${type[0].toUpperCase()}${type.slice(1)}`,
          text: text.slice(0, 4000), rect: { x: 0, y: 0, width: 0, height: 0 },
        } };
        const rect = describePresentationTarget(target).rect;
        // Never infer a source id by DOM ordinal: unsupported objects can be omitted by the renderer.
        const matches = fromSlide ? available.filter((shape) => shape.type === type &&
          ((!!text && shape.text === text) || (!!shape.rect && ["x", "y", "width", "height"].every((key) =>
            Math.abs(shape.rect![key as keyof typeof rect] - rect[key as keyof typeof rect]) < 0.008)))) : [];
        const exact = matches.filter((shape) => shape.rect && ["x", "y", "width", "height"].every((key) =>
          Math.abs(shape.rect![key as keyof typeof rect] - rect[key as keyof typeof rect]) < 0.008));
        const source = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
        if (source) {
          target.element = { ...target.element, name: source.name, shapeId: source.shapeId, sourcePart: source.sourcePart };
          available.splice(available.indexOf(source), 1);
        }
        targets.set(node, target);
      }
    };
    for (const layer of Array.from(slide.children)) {
      if (layer.matches(".slide-wrapper,.slide-master-wrapper,.slide-layout-wrapper")) visit(layer, layer.matches(".slide-wrapper"));
    }
  });
  return targets;
}
