import { defaultUrlTransform } from "react-markdown";

/** Paths belong to the selected backend, which can use a different OS. */
export function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(value);
}

export function isAbsoluteFilePath(value: string): boolean {
  return !value.includes("\0") && (isWindowsAbsolutePath(value) || (value.startsWith("/") && !value.startsWith("//")));
}

export function fileHrefPath(value: string): string {
  let result = value;
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return "";
      result = url.pathname;
      if (/^\/[a-z]:\//i.test(result)) result = result.slice(1);
    } catch { return ""; }
  }
  try { return decodeURIComponent(result); } catch { return result; }
}

export function fileBasename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

/** Permit local paths without admitting other nonstandard URL schemes. */
export function markdownFileUrlTransform(url: string): string {
  const file = fileHrefPath(url);
  return isAbsoluteFilePath(file) && (/^file:/i.test(url) || isWindowsAbsolutePath(file))
    ? url : defaultUrlTransform(url);
}

export function resolveDocumentImagePath(reference: string, documentPath: string): string {
  if (!isAbsoluteFilePath(documentPath) || reference.startsWith("#")) return reference;
  const file = fileHrefPath(reference);
  if (isAbsoluteFilePath(file)) return file;
  const windows = isWindowsAbsolutePath(documentPath);
  const normalized = windows ? documentPath.replace(/\\/g, "/") : documentPath;
  // Resolve relative references within a UNC share, preserving its native
  // spelling rather than turning //server into a browser network URL.
  const share = windows ? normalized.match(/^\/\/([^/]+)\/([^/]+)(\/.*)?$/) : null;
  const urlPath = share ? share[3] ?? "/" : normalized;
  const base = `file://${urlPath.startsWith("/") ? "" : "/"}${urlPath.split("/")
    .map((segment, index) => windows && index === 0 ? segment : encodeURIComponent(segment)).join("/")}`;
  const resolved = fileHrefPath(new URL(windows ? reference.replace(/\\/g, "/") : reference, base).href);
  return share && resolved.startsWith("/")
    ? `\\\\${share[1]}\\${share[2]}${resolved.replace(/\//g, "\\")}`
    : resolved;
}
