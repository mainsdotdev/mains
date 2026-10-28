/** Android grants another app temporary access to this one downloaded cache file. */
export function isCachedDocumentUri(uri: string, cacheDirectory: string): boolean {
  try {
    const path = decodeURIComponent(uri);
    const root = decodeURIComponent(cacheDirectory).replace(/\/+$/, "") + "/";
    return path.startsWith("file:///") && path.startsWith(root) && path.length > root.length && !path.endsWith("/") &&
      !path.split("/").some((part) => part === ".." || part === ".") && !path.includes("\u0000");
  } catch { return false; }
}
