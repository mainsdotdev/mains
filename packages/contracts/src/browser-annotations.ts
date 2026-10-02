/** The compact, durable annotation context displayed beside a sent prompt. */
export interface BrowserAnnotation {
  id: string;
  url: string;
  title?: string;
  comment?: string;
  elements: Array<{
    selector: string;
    tagName: string;
    text?: string;
    componentName?: string;
  }>;
}
