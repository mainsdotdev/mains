import * as fs from "fs";
import * as path from "path";

const MAX_HTML_SIZE = 10 * 1024 * 1024;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export const BROWSER_PREVIEW_SCHEME = "mains-preview";

export function browserPreviewUrl(tabId: string): string {
  return `${BROWSER_PREVIEW_SCHEME}://${tabId}/`;
}

export function isBrowserPreviewUrlForTab(tabId: string, url: string): boolean {
  const base = browserPreviewUrl(tabId);
  return url === base || url.startsWith(`${base}#`);
}

/** Validate on both tab creation and every request: the file may change later. */
export function requireHtmlPreviewPath(rawPath: string): string {
  if (!path.isAbsolute(rawPath) || rawPath.includes("\0")) {
    throw new Error("HTML preview requires an absolute file path");
  }
  const resolved = path.resolve(rawPath);
  if (!HTML_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("HTML preview supports .html and .htm files only");
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("HTML preview requires a regular file");
  }
  if (stat.size > MAX_HTML_SIZE) {
    throw new Error("HTML preview file is too large");
  }
  return resolved;
}

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function serveBrowserPreview(
  requestUrl: URL,
  getPathForTab: (tabId: string) => string | null,
): Response {
  if (
    requestUrl.protocol !== `${BROWSER_PREVIEW_SCHEME}:` ||
    !/^[0-9a-f-]{36}$/i.test(requestUrl.hostname) ||
    requestUrl.pathname !== "/" ||
    requestUrl.search
  ) {
    return new Response("Invalid preview URL", { status: 400 });
  }
  const filePath = getPathForTab(requestUrl.hostname);
  if (!filePath) return new Response("Preview not found", { status: 404 });
  try {
    const resolved = requireHtmlPreviewPath(filePath);
    return new Response(fs.readFileSync(resolved), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": PREVIEW_CSP,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
      },
    });
  } catch {
    return new Response("Preview file is unavailable", { status: 404 });
  }
}
