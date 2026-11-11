export type AnnotatableDocumentType = "pptx" | "pdf" | "docx";
/** Fractions of the rendered page, independent of zoom and screen density. */
export interface DocumentAnnotationRect { x: number; y: number; width: number; height: number }
export interface DocumentAnnotationElement {
  id: string;
  type: "text" | "image" | "shape" | "table" | "chart" | "region";
  name: string;
  text: string;
  rect: DocumentAnnotationRect;
  /** Separate line boxes for a text range rather than one large bounding box. */
  rects?: DocumentAnnotationRect[];
  shapeId?: string;
  sourcePart?: string;
  selector?: string;
  textAnchor?: { startOffset: number; endOffset: number; before: string; after: string };
}
export interface DocumentAnnotation {
  id: string;
  filePath: string;
  fileName: string;
  documentType: AnnotatableDocumentType;
  pageNumber: number;
  comment: string;
  elements: DocumentAnnotationElement[];
  screenshotAttachmentId?: string;
}
export function documentAnnotationPageLabel(annotation: Pick<DocumentAnnotation, "documentType" | "pageNumber">): string {
  return `${annotation.documentType === "pptx" ? "Slide" : "Page"} ${annotation.pageNumber}`;
}
export function documentAnnotationAttachmentName(annotation: Pick<DocumentAnnotation, "id" | "pageNumber">): string {
  return `document-page-${annotation.pageNumber}-annotation-${annotation.id}.png`;
}
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" ? value as Record<string, unknown> : null;
function readRect(value: unknown): DocumentAnnotationRect | null {
  const item = record(value);
  if (!item || !["x", "y", "width", "height"].every((key) => typeof item[key] === "number" && Number.isFinite(item[key])) ||
      (item.width as number) <= 0 || (item.height as number) <= 0) return null;
  return { x: item.x as number, y: item.y as number, width: item.width as number, height: item.height as number };
}
/** Also reads the original presentationAnnotations metadata without rewriting history. */
export function readDocumentAnnotations(value: unknown): DocumentAnnotation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((input: unknown) => {
    const item = record(input);
    if (!item || !["id", "filePath", "fileName", "comment"].every((key) => typeof item[key] === "string") || !Array.isArray(item.elements)) return [];
    const legacy = item.documentType === undefined && item.pageNumber === undefined && item.slideNumber !== undefined;
    const documentType = legacy ? "pptx" : item.documentType;
    const pageNumber = legacy ? item.slideNumber : item.pageNumber;
    if (!["pptx", "pdf", "docx"].includes(documentType as string) || typeof pageNumber !== "number" || !Number.isSafeInteger(pageNumber) || pageNumber < 1) return [];
    const elements: DocumentAnnotationElement[] = item.elements.flatMap((input: unknown) => {
      const element = record(input);
      if (!element || !["id", "name", "text"].every((key) => typeof element[key] === "string") ||
          !["text", "image", "shape", "table", "chart", "region"].includes(element.type as string)) return [];
      const rect = readRect(element.rect);
      if (!rect) return [];
      const rects = Array.isArray(element.rects) ? element.rects.flatMap((value) => { const rect = readRect(value); return rect ? [rect] : []; }) : [];
      const anchor = record(element.textAnchor);
      const textAnchor = anchor && typeof anchor.startOffset === "number" && Number.isSafeInteger(anchor.startOffset) && anchor.startOffset >= 0 &&
        typeof anchor.endOffset === "number" && Number.isSafeInteger(anchor.endOffset) && anchor.endOffset >= anchor.startOffset &&
        typeof anchor.before === "string" && typeof anchor.after === "string"
        ? { startOffset: anchor.startOffset, endOffset: anchor.endOffset, before: anchor.before, after: anchor.after } : undefined;
      return [{ id: element.id as string, name: element.name as string, text: element.text as string,
        type: element.type as DocumentAnnotationElement["type"], rect,
        ...(rects.length ? { rects } : {}), ...(textAnchor ? { textAnchor } : {}),
        ...(typeof element.shapeId === "string" ? { shapeId: element.shapeId } : {}),
        ...(typeof element.sourcePart === "string" ? { sourcePart: element.sourcePart } : {}),
        ...(typeof element.selector === "string" ? { selector: element.selector } : {}) }];
    });
    if (!elements.length) return [];
    return [{ id: item.id as string, filePath: item.filePath as string, fileName: item.fileName as string,
      documentType: documentType as AnnotatableDocumentType, pageNumber, comment: item.comment as string, elements,
      ...(typeof item.screenshotAttachmentId === "string" ? { screenshotAttachmentId: item.screenshotAttachmentId } : {}) }];
  });
}
