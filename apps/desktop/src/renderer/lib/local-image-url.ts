// Renderer-side cache + helpers for signed `mains-localimg://` URLs.
//
// The main process holds an HMAC secret and signs paths via the
// `imageProxy:sign` IPC. The signed URL is what the protocol handler accepts —
// there's no path allowlist in the handler anymore. The trade-off is that the
// IPC call is async, so renderer code that previously built URLs synchronously
// now has to await (or use `useLocalImageUrl` which renders without a src
// until the signing call resolves).

import { isWeb } from "./platform/platform";
import { proxiedImageSrc } from "./proxied-image-src";

const PASS_THROUGH = /^(data:|blob:|https?:|mains-localimg:|mains-capture:|mains-img:|mains-appicon:|\/__localimg|\/__img)/;

// In web mode the `mains-localimg://` custom protocol doesn't exist; the backend
// serves the same signed path over HTTP at `/__localimg`. Rewrite the scheme to
// that same-origin endpoint, keeping the (HMAC-signed) query intact.
function toWebLocalImageUrl(signed: string): string {
  try {
    return `/__localimg${new URL(signed).search}`;
  } catch {
    return signed;
  }
}

const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function isPassThroughSrc(src: string): boolean {
  return PASS_THROUGH.test(src);
}

/**
 * Displayable form of a pass-through src: remote http(s) URLs are routed
 * through the image proxy (the renderer CSP's `img-src` disallows arbitrary
 * https); every other pass-through scheme is returned unchanged.
 */
export function resolvePassThroughSrc(src: string): string {
  return proxiedImageSrc(src) ?? src;
}

export function getCachedSignedUrl(absPath: string): string | undefined {
  return urlCache.get(absPath);
}

export async function signLocalImage(absPath: string): Promise<string | null> {
  if (!absPath) return null;
  const cached = urlCache.get(absPath);
  if (cached) return cached;

  const existing = inflight.get(absPath);
  if (existing) return existing;

  const promise = window.api.imageProxy
    .sign(absPath)
    .then((res: { success: true; data: string } | { success: false; error: string }) => {
      if (!res.success) return null;
      const url = isWeb ? toWebLocalImageUrl(res.data) : res.data;
      urlCache.set(absPath, url);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(absPath);
    });
  inflight.set(absPath, promise);
  return promise;
}

/**
 * Set `img.src` once the path has been signed. Returns a cancel function for
 * callers that may unmount before signing resolves. Used by the imperative DOM
 * code in `rich-input-form` that can't host React hooks.
 */
export function applySignedSrc(img: HTMLImageElement, src: string): () => void {
  if (isPassThroughSrc(src)) {
    img.src = resolvePassThroughSrc(src);
    return () => {};
  }
  const cached = urlCache.get(src);
  if (cached) {
    img.src = cached;
    return () => {};
  }
  let cancelled = false;
  signLocalImage(src).then((url) => {
    if (cancelled || !url) return;
    img.src = url;
  });
  return () => {
    cancelled = true;
  };
}
