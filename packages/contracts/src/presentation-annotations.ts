/** Coordinates are fractions of the slide, independent of preview zoom. */
export interface PresentationElement {
  id: string;
  type: "text" | "image" | "shape" | "table" | "chart";
  name: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Present only when the rendered object can be matched to the source. */
  shapeId?: string;
  sourcePart?: string;
}

export interface PresentationAnnotation {
  id: string;
  filePath: string;
  fileName: string;
  slideNumber: number;
  comment: string;
  elements: PresentationElement[];
  screenshotAttachmentId?: string;
}

export function presentationAnnotationAttachmentName(annotation: Pick<PresentationAnnotation, "id" | "slideNumber">): string {
  return `presentation-slide-${annotation.slideNumber}-annotation-${annotation.id}.png`;
}

/** Compact, validated context for saved prompts; capture bytes stay attachments. */
export function readPresentationAnnotations(value: unknown): PresentationAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item.id !== "string" || typeof item.filePath !== "string" ||
        typeof item.fileName !== "string" || typeof item.comment !== "string" ||
        !Number.isSafeInteger(item.slideNumber) || item.slideNumber < 1 || !Array.isArray(item.elements)) return [];
    const elements: PresentationElement[] = item.elements.flatMap((element: any) => {
      if (!element || typeof element.id !== "string" || typeof element.name !== "string" ||
          typeof element.text !== "string" || !["text", "image", "shape", "table", "chart"].includes(element.type) ||
          !element.rect || !["x", "y", "width", "height"].every((key) => Number.isFinite(element.rect[key])) ||
          element.rect.width <= 0 || element.rect.height <= 0) return [];
      return [{ id: element.id, type: element.type, name: element.name, text: element.text, rect: {
        x: element.rect.x, y: element.rect.y, width: element.rect.width, height: element.rect.height,
      }, ...(typeof element.shapeId === "string" ? { shapeId: element.shapeId } : {}),
      ...(typeof element.sourcePart === "string" ? { sourcePart: element.sourcePart } : {}) }];
    });
    if (!elements.length) return [];
    return [{ id: item.id, filePath: item.filePath, fileName: item.fileName, slideNumber: item.slideNumber,
      comment: item.comment, elements,
      ...(typeof item.screenshotAttachmentId === "string" ? { screenshotAttachmentId: item.screenshotAttachmentId } : {}) }];
  });
}
