import type { DocumentAnnotationElement, DocumentAnnotationRect } from "@mains/contracts/document-annotations";

export interface DocumentTarget {
  node: Element;
  page: HTMLElement;
  pageNumber: number;
  element: DocumentAnnotationElement;
  /** Ranges/regions retain normalized geometry across PDF canvas/text-layer replacements. */
  fixedRects?: DocumentAnnotationRect[];
}
export interface DocumentAnnotationSurface {
  root: HTMLElement;
  viewport: HTMLElement;
  pages: () => HTMLElement[];
  targets: Map<Element, DocumentTarget>;
  textSelection: boolean;
}
export type DocumentSelectionMode = "content" | "region";
export function normalizedDocumentRect(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, page: DOMRect): DocumentAnnotationRect {
  return { x: (rect.left - page.left) / page.width, y: (rect.top - page.top) / page.height,
    width: rect.width / page.width, height: rect.height / page.height };
}
export function documentTargetRects(target: DocumentTarget): DocumentAnnotationRect[] {
  if (target.fixedRects) return target.fixedRects;
  let bounds = target.node.getBoundingClientRect();
  if (!(bounds.width > 0 && bounds.height > 0)) bounds = target.node.firstElementChild?.getBoundingClientRect() ?? bounds;
  return [normalizedDocumentRect(bounds, target.page.getBoundingClientRect())];
}
function unionRects(rects: DocumentAnnotationRect[]): DocumentAnnotationRect {
  if (rects.length === 1) return rects[0];
  let x = Infinity; let y = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const rect of rects) { x = Math.min(x, rect.x); y = Math.min(y, rect.y); right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height); }
  return { x, y, width: right - x, height: bottom - y };
}
export function describeDocumentTarget(target: DocumentTarget): DocumentAnnotationElement {
  const rects = documentTargetRects(target);
  return { ...target.element, rect: unionRects(rects), ...(rects.length > 1 ? { rects } : {}) };
}
export function documentPageForNode(surface: DocumentAnnotationSurface, node: Node): HTMLElement | undefined {
  return surface.pages().find((page) => page === node || page.contains(node));
}
export function documentRegionTarget(page: HTMLElement, pageNumber: number, start: { x: number; y: number }, end: { x: number; y: number }): DocumentTarget | null {
  const bounds = page.getBoundingClientRect();
  const left = Math.max(bounds.left, Math.min(start.x, end.x)); const top = Math.max(bounds.top, Math.min(start.y, end.y));
  const right = Math.min(bounds.right, Math.max(start.x, end.x)); const bottom = Math.min(bounds.bottom, Math.max(start.y, end.y));
  if (right - left < 4 || bottom - top < 4 || !bounds.width || !bounds.height) return null;
  const rect = normalizedDocumentRect({ left, top, width: right - left, height: bottom - top }, bounds);
  return { node: page, page, pageNumber, fixedRects: [rect], element: {
    id: crypto.randomUUID(), type: "region", name: "Selected area", text: "", rect,
  } };
}

/** A native text range carries exact text, nearby context and separate boxes for each line. */
export function documentTextTarget(surface: DocumentAnnotationSurface, range: Range, selectedText = range.toString()): DocumentTarget | null {
  if (range.collapsed || !range.toString().trim()) return null;
  const page = documentPageForNode(surface, range.startContainer);
  if (!page || !page.contains(range.endContainer)) return null;
  const pageBounds = page.getBoundingClientRect();
  if (!pageBounds.width || !pageBounds.height) return null;
  const seen = new Set<string>();
  const rects = Array.from(range.getClientRects()).flatMap((rect) => {
    const left = Math.max(rect.left, pageBounds.left); const top = Math.max(rect.top, pageBounds.top);
    const right = Math.min(rect.right, pageBounds.right); const bottom = Math.min(rect.bottom, pageBounds.bottom);
    return right > left && bottom > top ? [normalizedDocumentRect({ left, top, width: right - left, height: bottom - top }, pageBounds)] : [];
  }).filter((rect) => {
    const key = [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 1_000_000)).join(",");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (!rects.length) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(page); prefix.setEnd(range.startContainer, range.startOffset);
  const suffix = range.cloneRange(); suffix.selectNodeContents(page); suffix.setStart(range.endContainer, range.endOffset);
  const startOffset = prefix.toString().length;
  const text = selectedText;
  return { node: page, page, pageNumber: surface.pages().indexOf(page) + 1, fixedRects: rects,
    element: { id: crypto.randomUUID(), type: "text", name: "Selected text", text: text.slice(0, 8000), rect: unionRects(rects),
      textAnchor: { startOffset, endOffset: startOffset + range.toString().length, before: prefix.toString().slice(-160), after: suffix.toString().slice(0, 160) } } };
}

function nativeSelection(surface: DocumentAnnotationSurface): Selection | null {
  const root = surface.root.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  return root.getSelection?.() ?? document.getSelection();
}

/** Native DOM events are shared by PPTX objects, DOCX blocks and virtualized PDF text layers. */
export function observeDocumentSelection(surface: DocumentAnnotationSurface, mode: DocumentSelectionMode, callbacks: {
  hover: (target: DocumentTarget | null) => void;
  select: (target: DocumentTarget) => void;
  invalidRange: () => void;
}): () => void {
  const { root } = surface;
  let drag: { page: HTMLElement; x: number; y: number; pointerId: number } | null = null;
  let textPointer: number | null = null;
  let ignoreClick = false;
  const pick = (event: Event): DocumentTarget | null => {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      const indexed = surface.targets.get(node);
      if (indexed) return indexed;
      if (node.hasAttribute("data-document-text")) {
        const range = document.createRange(); range.selectNodeContents(node);
        const target = documentTextTarget(surface, range);
        if (target) return { ...target, element: { ...target.element, id: node.getAttribute("data-document-text")! } };
      }
    }
    return null;
  };
  const move = (event: Event) => { if (!drag && mode === "content") callbacks.hover(pick(event)); };
  const leave = () => { if (!drag) callbacks.hover(null); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    ignoreClick = false;
    if (mode === "region") {
      const node = event.composedPath().find((node) => node instanceof Node && documentPageForNode(surface, node)) as Node | undefined;
      const page = node && documentPageForNode(surface, node);
      if (!page) return;
      event.preventDefault();
      drag = { page, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    } else if (!surface.textSelection && pick(event)) event.preventDefault();
    else if (surface.textSelection) textPointer = event.pointerId;
  };
  const dragMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    callbacks.hover(documentRegionTarget(drag.page, surface.pages().indexOf(drag.page) + 1, drag, { x: event.clientX, y: event.clientY }));
  };
  const up = (event: PointerEvent) => {
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      const target = documentRegionTarget(drag.page, surface.pages().indexOf(drag.page) + 1, drag, { x: event.clientX, y: event.clientY });
      drag = null; ignoreClick = true; callbacks.hover(null);
      if (target) callbacks.select(target);
      return;
    }
    if (!surface.textSelection || mode !== "content" || textPointer !== event.pointerId) return;
    textPointer = null;
    const selection = nativeSelection(surface);
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!documentPageForNode(surface, range.startContainer)) return;
    ignoreClick = true;
    const target = documentTextTarget(surface, range, selection.toString());
    if (target) { callbacks.select(target); selection.removeAllRanges(); document.getSelection()?.removeAllRanges(); }
    else callbacks.invalidRange();
  };
  const cancel = () => { drag = null; textPointer = null; callbacks.hover(null); };
  const click = (event: Event) => {
    if (ignoreClick || mode === "region") { event.preventDefault(); event.stopPropagation(); ignoreClick = false; return; }
    const target = pick(event);
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); callbacks.select(target);
  };
  const key = (event: KeyboardEvent) => {
    if (event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
    const target = pick(event);
    if (target) { event.preventDefault(); event.stopPropagation(); callbacks.select(target); }
  };
  const saved = Array.from(surface.targets.keys(), (node) => {
    const attributes = ["tabindex", "role", "aria-label"].map((name) => [name, node.getAttribute(name)] as const);
    node.setAttribute("tabindex", "0"); node.setAttribute("role", "button");
    const target = surface.targets.get(node)!;
    node.setAttribute("aria-label", `Annotate ${target.element.name}, page ${target.pageNumber}`);
    return { node, attributes };
  });
  const cursor = root.style.cursor;
  const previousMode = root.getAttribute("data-document-selection-mode");
  root.setAttribute("data-document-selection-mode", mode);
  root.style.setProperty("cursor", mode === "region" || !surface.textSelection ? "crosshair" : "auto");
  root.addEventListener("pointerover", move); root.addEventListener("focusin", move); root.addEventListener("pointerleave", leave);
  root.addEventListener("pointerdown", down, true); root.addEventListener("click", click, true); root.addEventListener("keydown", key, true);
  document.addEventListener("pointermove", dragMove, true); document.addEventListener("pointerup", up, true); document.addEventListener("pointercancel", cancel, true);
  return () => {
    root.style.setProperty("cursor", cursor);
    if (previousMode === null) root.removeAttribute("data-document-selection-mode"); else root.setAttribute("data-document-selection-mode", previousMode);
    root.removeEventListener("pointerover", move); root.removeEventListener("focusin", move); root.removeEventListener("pointerleave", leave);
    root.removeEventListener("pointerdown", down, true); root.removeEventListener("click", click, true); root.removeEventListener("keydown", key, true);
    document.removeEventListener("pointermove", dragMove, true); document.removeEventListener("pointerup", up, true); document.removeEventListener("pointercancel", cancel, true);
    for (const { node, attributes } of saved) for (const [name, value] of attributes) {
      if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
    }
  };
}

export function docxAnnotationSurface(root: HTMLElement, viewport: HTMLElement): DocumentAnnotationSurface {
  const pages = () => Array.from(root.querySelectorAll<HTMLElement>("section.docx"));
  const targets = new Map<HTMLElement, DocumentTarget>();
  pages().forEach((page, index) => {
    Array.from(page.querySelectorAll<HTMLElement>("p,li,table,img,svg")).forEach((node, ordinal) => {
      // Table cells remain part of the table; inline text runs remain part of their paragraph.
      if (node.closest("table") && node.tagName !== "TABLE") return;
      const type = node.matches("img,svg") ? "image" : node.matches("table") ? "table" : "text";
      const text = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 8000);
      if (!text && type === "text") return;
      const id = `page-${index + 1}-block-${ordinal}`;
      node.setAttribute("data-document-block", id);
      targets.set(node, { node, page, pageNumber: index + 1, element: {
        id, type, name: type === "text" ? "Paragraph" : type === "table" ? "Table" : "Image", text,
        selector: `[data-document-block="${id}"]`,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      } });
    });
  });
  return { root, viewport, pages, targets, textSelection: true };
}
