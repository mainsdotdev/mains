// Pure helpers for the in-app document viewer. Kept free of React/DOM so they
// can be unit-tested in the repo's node-only vitest environment.

/** Formats rendered by the shadow-DOM render host from raw bytes. */
export type OfficeDocType = "docx" | "xlsx" | "pptx";

/**
 * Everything the viewer can show. Office formats go through the render host;
 * text ones (`md`) are React all the way down, so they keep the app's theme
 * and typography instead of living behind a shadow boundary.
 */
export type DocType = OfficeDocType | "md";

/** Renderer module key dispatched on by the render host. */
export type RendererKey = OfficeDocType;

const EXT_TO_DOC_TYPE: Record<string, DocType> = {
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".pptx": "pptx",
  ".md": "md",
  ".markdown": "md",
};

/**
 * Classify a file name or path into a viewer DocType, or `null` when the viewer
 * can't show it. Legacy binary formats (.doc/.xls/.ppt) return null — the
 * pure-JS renderers can't read them, so they fall through to "Open with…".
 */
export function classifyDocType(fileNameOrPath: string): DocType | null {
  if (!fileNameOrPath) return null;
  // Strip any query/hash suffix, then take the last extension.
  const clean = fileNameOrPath.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = clean.slice(dot).toLowerCase();
  return EXT_TO_DOC_TYPE[ext] ?? null;
}

export const DOC_VIEWER_LABELS: Record<DocType, string> = {
  docx: "Word Document",
  xlsx: "Spreadsheet",
  pptx: "Presentation",
  md: "Markdown",
};

/** Text formats render as React, not as bytes through the shadow-DOM host. */
export function isTextDocType(docType: DocType): docType is "md" {
  return docType === "md";
}

/** Maps an Office DocType to its renderer module key. Identity today, but kept
 * explicit so the dispatch is a single tested unit and easy to extend. */
export function pickRenderer(docType: OfficeDocType): RendererKey {
  return docType;
}

/**
 * Decide whether the render host should show the fallback ("Open with…") state.
 * Centralised + pure so the PPTX empty-render case is unit-testable without a
 * DOM: fall back if the renderer threw OR produced no DOM nodes.
 */
export function shouldFallback(result: {
  threw: boolean;
  producedNodes: number;
}): boolean {
  return result.threw || result.producedNodes === 0;
}

const ALL_DOC_EXTENSIONS = [".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"];

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/**
 * Is this image actually a rendered *preview* of a generated Office document
 * (e.g. the per-page PNGs `qlmanage`/LibreOffice emit), rather than an image the
 * agent was asked to produce? Two signals, both keyed off the document outputs
 * so intentionally-generated images are never caught:
 *   1. filename stem ends with a document extension — "brief.docx.png"
 *   2. the image sits in a SUBdirectory of a generated document's folder —
 *      "…/outputs/documents/rendered-brief/slide-01.png" (a sibling image in
 *      the doc's own folder is left alone)
 */
export function isDocumentRenderImage(
  imagePath: string,
  documentPaths: string[],
): boolean {
  if (!imagePath || documentPaths.length === 0) return false;
  const lower = imagePath.toLowerCase();
  const stem = lower.replace(/\.(png|jpe?g|webp|gif)$/i, "");
  if (ALL_DOC_EXTENSIONS.some((ext) => stem.endsWith(ext))) return true;

  const imgDir = dirOf(imagePath);
  for (const docPath of documentPaths) {
    const docDir = dirOf(docPath);
    if (docDir && imgDir.startsWith(docDir + "/")) return true;
  }
  return false;
}
