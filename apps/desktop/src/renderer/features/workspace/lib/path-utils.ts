/** Strip leading "./" or "/" from a path for comparison. */
export function normalizePath(path: string): string {
  return path.replace(/^\.?\//, "");
}

/** Check if two normalized paths refer to the same file (handles prefix differences). */
export function pathsMatch(a: string, b: string): boolean {
  return a === b || a.endsWith("/" + b) || b.endsWith("/" + a);
}

/** Abbreviate deep paths to their last 3 segments (".../a/b/c"); shallow paths pass through. */
export function shortPath(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.length > 3 ? ".../" + parts.slice(-3).join("/") : fullPath;
}

/** Collapse deep paths to just the file name; shallow paths pass through. */
export function shortFileName(fullPath: string): string {
  const parts = fullPath.split("/");
  return parts.length > 3 ? parts[parts.length - 1] : fullPath;
}
