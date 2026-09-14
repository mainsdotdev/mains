// Renderer-side cache + helper for signed `mains-localdoc://` URLs. Mirrors
// `local-image-url.ts`: the main process holds an HMAC secret and signs paths
// via the `documents:sign` IPC; the signed URL is what the protocol handler
// accepts. The render host `fetch()`es the returned URL to get the document's
// raw bytes (the protocol handler re-stats the file and enforces symlink/size/
// mime guards).

import { isWeb } from "./platform/platform";

const PASS_THROUGH = /^(mains-localdoc:|https?:|data:|blob:|\/__localdoc)/;

// Web mode: the `mains-localdoc://` protocol doesn't exist in a browser; the
// backend serves the same signed path over HTTP at `/__localdoc`. Rewrite the
// scheme to that same-origin endpoint, keeping the HMAC-signed query intact.
function toWebLocalDocUrl(signed: string): string {
  try {
    return `/__localdoc${new URL(signed).search}`;
  } catch {
    return signed;
  }
}

const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function isPassThroughDocSrc(src: string): boolean {
  return PASS_THROUGH.test(src);
}

export function getCachedSignedDocUrl(absPath: string): string | undefined {
  return urlCache.get(absPath);
}

export async function signLocalDocument(absPath: string): Promise<string | null> {
  if (!absPath) return null;
  const cached = urlCache.get(absPath);
  if (cached) return cached;

  const existing = inflight.get(absPath);
  if (existing) return existing;

  const promise = window.api.documents
    .sign(absPath)
    .then((res: { success: true; data: string } | { success: false; error: string }) => {
      if (!res.success) return null;
      const url = isWeb ? toWebLocalDocUrl(res.data) : res.data;
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
