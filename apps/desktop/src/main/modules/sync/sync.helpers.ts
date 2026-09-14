

// ─────────────────────────────────────────────────────────────
// URL Helpers
// ─────────────────────────────────────────────────────────────
export function pickUrl(node: unknown): string | null {
  if (!node) return null;

  if (typeof node === "string") {
    return node || null;
  }

  if (Array.isArray(node)) {
    return pickUrl(node[0]);
  }

  if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.href === "string") return obj.href;
    if (typeof obj._ === "string") return obj._;
    if (typeof obj.__cdata === "string") return obj.__cdata;
    
    const $ = obj.$ as Record<string, unknown> | undefined;
    if ($ && typeof $.url === "string") return $.url;
  }

  return null;
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sanitizeUrl(url: string | null | undefined, fallback = "#"): string {
  if (!url) return fallback;
  if (isValidUrl(url)) return url;
  return fallback;
}

// ─────────────────────────────────────────────────────────────
// Duration Formatting
// ─────────────────────────────────────────────────────────────
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}
