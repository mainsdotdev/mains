const DOCUMENT_EXTENSIONS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pdf",
]);

const DOCUMENT_BUNDLE_SIDECARS = new Set([
  "fodp",
  "fodt",
  "fods",
  "odp",
  "odt",
  "ods",
  "html",
  "htm",
  "svg",
]);

const VERSION_SUFFIX =
  /(?:[\s._\u2013\u2014-]+(?:draft|final|preview|render|export|working|latest|copy|rev(?:ision)?\d*|v\d+))+$/i;

function basename(value: string): string {
  const clean = value.split(/[?#]/, 1)[0].replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || value;
}

function fileParts(value: string): { stem: string; extension: string } {
  const name = basename(value);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, extension: "" };
  }
  return {
    stem: name.slice(0, dot),
    extension: name.slice(dot + 1).toLocaleLowerCase(),
  };
}

/**
 * A stable family name for iterative outputs. Presentation/document generators
 * commonly alternate spaces, dashes, and underscores, or append a draft/final
 * suffix while refining one logical file.
 */
export function deliverableStem(value: string): string {
  const { stem } = fileParts(value);
  const withoutVersion = stem.replace(VERSION_SUFFIX, "");
  const normalized = withoutVersion
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._\u2013\u2014-]+/g, "");
  return normalized || stem.toLocaleLowerCase();
}

/** Same logical document + format, independent of folder and revision spelling. */
export function documentDeliverableKey(value: string): string | null {
  const { extension } = fileParts(value);
  if (!DOCUMENT_EXTENSIONS.has(extension)) return null;
  return `${deliverableStem(value)}:${extension}`;
}

export function documentBundleStem(value: string): string | null {
  return documentDeliverableKey(value) ? deliverableStem(value) : null;
}

/** Generated working formats are hidden only when their final document exists. */
export function isDocumentBundleSidecar(
  value: string,
  documentStems: ReadonlySet<string>,
): boolean {
  const { extension } = fileParts(value);
  return (
    DOCUMENT_BUNDLE_SIDECARS.has(extension) &&
    documentStems.has(deliverableStem(value))
  );
}

export function deliverableDedupeKey(value: string): string {
  const documentKey = documentDeliverableKey(value);
  return documentKey ?? basename(value).normalize("NFKC").toLocaleLowerCase();
}
