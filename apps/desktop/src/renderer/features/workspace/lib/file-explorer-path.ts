/** Keep nearby folders visible without spending the row on distant ancestors. */
export function compactDirectoryPath(directory: string): string {
  const parts = directory.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : directory;
}
