import type { AnnotatableDocumentType, DocumentAnnotationElement } from "@mains/contracts/document-annotations";

/** Freeze one rendered page, including chart canvases, without capturing app chrome. */
export async function captureDocumentPage(page: HTMLElement, elements: DocumentAnnotationElement[], documentType: AnnotatableDocumentType): Promise<string> {
  if (documentType === "pdf") {
    const source = page.querySelector("canvas");
    if (!source?.width || !source.height) throw new Error("Scroll the selected page into view before adding the annotation");
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1440 / source.width, 1440 / source.height);
    canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not capture this page");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "Highlight";
    context.lineWidth = 2;
    for (const element of elements) for (const rect of element.rects ?? [element.rect]) {
      context.strokeRect(rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  }
  // DOCX uses pt/cm paper sizes; their numeric CSS values are not CSS pixels.
  const width = page.offsetWidth || Number.parseFloat(page.style.width);
  const height = page.offsetHeight || Number.parseFloat(page.style.height);
  if (!(width > 0 && height > 0)) throw new Error("The selected page is not visible");
  await document.fonts.ready;
  const clone = page.cloneNode(true) as HTMLElement;
  const originals = [page, ...Array.from(page.querySelectorAll("*"))];
  const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (const [index, original] of originals.entries()) {
    const copy = copies[index] as HTMLElement | SVGElement;
    const computed = getComputedStyle(original);
    for (const property of Array.from(computed)) copy.style.setProperty(property, computed.getPropertyValue(property));
    if (original instanceof HTMLCanvasElement) {
      const image = document.createElement("img");
      image.src = original.toDataURL("image/png");
      image.style.cssText = copy.style.cssText;
      copy.replaceWith(image);
    } else if (original instanceof HTMLImageElement) {
      await original.decode();
      // Office media are embedded data URLs. Preserve the decoded resource instead of responsive sources.
      copy.setAttribute("src", original.currentSrc || original.src);
      copy.removeAttribute("srcset");
    }
  }
  Object.assign(clone.style, { margin: "0", border: "0", boxShadow: "none", position: "relative",
    left: "0", top: "0", transform: "none", zoom: "1", boxSizing: "border-box", width: `${width}px`, height: `${height}px` });
  clone.querySelectorAll("script,style").forEach((node) => node.remove());
  if (documentType === "docx") {
    // Keep generated list counters, pseudo-elements and embedded document fonts.
    const style = document.createElement("style");
    const root = page.getRootNode() as ShadowRoot;
    style.textContent = Array.from(root.querySelectorAll("style"), (node) => node.textContent).join("\n");
    clone.prepend(style);
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const body = document.createElementNS(svg.namespaceURI, "foreignObject");
  body.setAttribute("width", "100%"); body.setAttribute("height", "100%");
  body.append(clone); svg.append(body);
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "Highlight";
  for (const element of elements) for (const bounds of element.rects ?? [element.rect]) {
    const rect = document.createElementNS(svg.namespaceURI, "rect");
    rect.setAttribute("x", String(bounds.x * width)); rect.setAttribute("y", String(bounds.y * height));
    rect.setAttribute("width", String(bounds.width * width)); rect.setAttribute("height", String(bounds.height * height));
    rect.setAttribute("fill", "none"); rect.setAttribute("stroke", accent); rect.setAttribute("stroke-width", "3");
    svg.append(rect);
  }
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await image.decode();
  const scale = Math.min(1, 1440 / width, 1440 / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not capture this page");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png").split(",")[1];
}
