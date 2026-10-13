/** The compact, durable annotation context displayed beside a sent prompt. */
export interface BrowserAnnotation {
  id: string;
  url: string;
  title?: string;
  comment?: string;
  /** The screenshot stays a chat attachment, separate from ordinary uploads. */
  screenshotAttachmentId?: string;
  elements: Array<{
    selector: string;
    tagName: string;
    text?: string;
    componentName?: string;
  }>;
}

/** Also identifies screenshots in historical prompts without the durable link. */
export function browserAnnotationAttachmentName(annotation: Pick<BrowserAnnotation, "id" | "url">): string {
  let host = "page";
  try { host = new URL(annotation.url).hostname; } catch { /* Same fallback as browser captures. */ }
  return `browser-${host}-annotation-${annotation.id.slice(0, 6)}.png`;
}
