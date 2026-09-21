import { isWeb } from "./platform/platform";
import { webToken } from "./platform/web-token";

/**
 * Remote http(s) image URLs cannot load directly under the renderer CSP (`img-src` disallows arbitrary https).
 * Route them through mains-img — see `registerImageProxyHandler` (main).
 */
export function proxiedImageSrc(src: string | undefined | null): string | undefined {
  if (!src) return undefined;
  if (src.startsWith("https://") || src.startsWith("http://")) {
    // Web mode: route through the backend's same-origin HTTP image proxy instead
    // of the Electron `mains-img://` custom protocol.
    // The proxy takes the owner token; an <img> can only carry it in the URL.
    if (isWeb) {
      const token = webToken();
      const auth = token ? `&token=${encodeURIComponent(token)}` : "";
      return `/__img?url=${encodeURIComponent(src)}${auth}`;
    }
    return `mains-img://proxy?url=${encodeURIComponent(src)}`;
  }
  return src;
}
