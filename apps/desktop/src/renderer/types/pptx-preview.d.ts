// `pptx-preview` ships as ESM with no bundled type declarations. Declare the
// minimal surface we use (the `init` factory returning a previewer).
declare module "pptx-preview" {
  export interface PptxPreviewer {
    preview: (data: ArrayBuffer) => Promise<void> | void;
  }
  export function init(
    container: HTMLElement,
    options: { width: number; height: number },
  ): PptxPreviewer;
}
