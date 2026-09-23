import { isWeb } from "./platform/platform";

/**
 * Remote http(s) image URLs cannot load directly under the renderer CSP (`img-src` disallows arbitrary https).
 * Route them through mains-img — see `registerImageProxyHandler` (main).
 */
export function proxiedImageSrc(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("https://") || src.startsWith("http://")) {
    // Web mode: route through the backend's same-origin HTTP image proxy instead
    // of the Electron `mains-img://` custom protocol. The browser authorizes it
    // with the HttpOnly cookie set at web bootstrap, never a token in the URL.
    if (isWeb) {
      return `/__img?url=${encodeURIComponent(src)}`;
    }
    return `mains-img://proxy?url=${encodeURIComponent(src)}`;
  }
  return src;
}
