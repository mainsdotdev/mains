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
import type { LocalImagePreviewSize } from "@mains/contracts/image-preview";
import { onTransportChange } from "./transport/registry";

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

const urlCache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();
let revision = 0;

onTransportChange(() => {
  revision++;
  urlCache.clear();
  inflight.clear();
  for (const listener of listeners) listener();
});

export const localImageUrlRevision = () => revision;
export function subscribeLocalImageUrls(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function cacheKey(absPath: string, maxSide?: LocalImagePreviewSize): string {
  return JSON.stringify([absPath, maxSide]);
}

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

export function getCachedSignedUrl(absPath: string, maxSide?: LocalImagePreviewSize): string | undefined {
  const key = cacheKey(absPath, maxSide);
  const entry = urlCache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= Date.now() + 30_000) { urlCache.delete(key); return undefined; }
  return entry.url;
}

export async function signLocalImage(absPath: string, maxSide?: LocalImagePreviewSize): Promise<string | null> {
  if (!absPath) return null;
  const key = cacheKey(absPath, maxSide);
  const startedRevision = revision;
  const cached = getCachedSignedUrl(absPath, maxSide);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const request = maxSide === undefined ? window.api.imageProxy.sign(absPath) : window.api.imageProxy.sign(absPath, maxSide);
  const promise = request
    .then((res: { success: true; data: string } | { success: false; error: string }) => {
      if (!res.success || startedRevision !== revision) return null;
      const url = isWeb ? toWebLocalImageUrl(res.data) : res.data;
      const expires = Number(new URL(res.data).searchParams.get("exp")) || Date.now() + 60 * 60 * 1000;
      urlCache.set(key, { url, expires });
      if (urlCache.size > 512) urlCache.delete(urlCache.keys().next().value!);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
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
  const cached = getCachedSignedUrl(src);
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
