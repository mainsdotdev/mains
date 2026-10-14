/** Decode a local Markdown destination without confusing encoded filename
 * characters with navigation suffixes. Filesystem root checks belong to hosts. */
export function localFileReference(reference: string): { path: string; line?: number } | null {
  let value = reference.trim().replace(/^<|>$/g, "");
  if (!value || value.startsWith("#") || value.startsWith("//")) return null;
  const locator = value.match(/^(.*?)(?:#L(\d+)(?:-\d+)?|:(\d+)(?::\d+)?)$/);
  const line = locator ? Number(locator[2] ?? locator[3]) : undefined;
  if (locator) value = locator[1];
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== "localhost") return null;
      value = url.pathname;
      if (/^\/[a-z]:\//i.test(value)) value = value.slice(1);
    } catch { return null; }
  } else {
    if (!/^[a-z]:[\\/]/i.test(value) && /^[a-z][\w+.-]*:/i.test(value)) return null;
    value = value.split(/[?#]/, 1)[0];
  }
  try { value = decodeURIComponent(value); } catch { /* Literal percent in a filename. */ }
  if (!value || value.includes("\0") || value.length > 4096) return null;
  return { path: value, ...(line === undefined ? {} : { line }) };
}
