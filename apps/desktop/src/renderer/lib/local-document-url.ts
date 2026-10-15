// Renderer-side cache + helper for signed `mains-localdoc://` URLs. Mirrors
// `local-image-url.ts`: the main process holds an HMAC secret and signs paths
// via the `documents:sign` IPC; the signed URL is what the protocol handler
// accepts. The render host `fetch()`es the returned URL to get the document's
// raw bytes (the protocol handler re-stats the file and enforces symlink/size/
// mime guards).

import { isWeb } from "./platform/platform";
import { onTransportChange } from "./transport/registry";
import { DOCUMENT_PREVIEW_MAX_BYTES } from "@mains/contracts/output-files";

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
export const localDocumentUrlRevision = () => revision;
export function subscribeLocalDocumentUrls(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isPassThroughDocSrc(src: string): boolean {
  return PASS_THROUGH.test(src);
}

export function getCachedSignedDocUrl(absPath: string): string | undefined {
  const entry = urlCache.get(absPath);
  if (!entry) return undefined;
  if (entry.expires <= Date.now() + 30_000) { urlCache.delete(absPath); return undefined; }
  return entry.url;
}

export async function signLocalDocument(absPath: string): Promise<string | null> {
  if (!absPath) return null;
  const startedRevision = revision;
  const cached = getCachedSignedDocUrl(absPath);
  if (cached) return cached;

  const existing = inflight.get(absPath);
  if (existing) return existing;

  const promise = window.api.documents
    .sign(absPath)
    .then((res: { success: true; data: string } | { success: false; error: string }) => {
      if (!res.success || startedRevision !== revision) return null;
      const url = isWeb ? toWebLocalDocUrl(res.data) : res.data;
      const expires = Number(new URL(res.data).searchParams.get("exp"));
      if (!Number.isFinite(expires) || expires <= Date.now()) return null;
      urlCache.set(absPath, { url, expires });
      if (urlCache.size > 512) urlCache.delete(urlCache.keys().next().value!);
      return url;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(absPath) === promise) inflight.delete(absPath);
    });
  inflight.set(absPath, promise);
  return promise;
}

/** Sign at the read boundary; one rejected signature gets one fresh attempt.
 * Loaded document bytes do not need to be re-rendered as their URL expires. */
export async function fetchLocalDocument(path: string, options: RequestInit = {}): Promise<Response> {
  const startedRevision = revision;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (options.signal?.aborted || revision !== startedRevision) throw new DOMException("Document read canceled", "AbortError");
    const url = isPassThroughDocSrc(path) ? path : await signLocalDocument(path);
    if (!url) throw new Error("Could not authorize this document");
    if (options.signal?.aborted || revision !== startedRevision) throw new DOMException("Document read canceled", "AbortError");
    const response = await fetch(url, { ...options, cache: "no-cache" });
    if (revision !== startedRevision) { await response.body?.cancel(); throw new DOMException("Document read canceled", "AbortError"); }
    if (response.status !== 403 || attempt === 1 || isPassThroughDocSrc(path)) {
      if (!response.ok) throw new DocumentReadError(response.status);
      return response;
    }
    await response.body?.cancel();
    urlCache.delete(path);
  }
  throw new Error("Could not open this document");
}

export class DocumentReadError extends Error {
  constructor(public readonly status: number) {
    super(status === 413 ? `This document exceeds the ${DOCUMENT_PREVIEW_MAX_BYTES / (1024 * 1024)} MiB inline preview limit. Save a copy or open it in another app.`
      : status === 404 ? "The original document is no longer available."
      : "This document could not be opened. Try opening it again.");
  }
}
