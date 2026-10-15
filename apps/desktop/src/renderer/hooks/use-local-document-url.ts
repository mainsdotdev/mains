import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getCachedSignedDocUrl,
  isPassThroughDocSrc,
  signLocalDocument,
  localDocumentUrlRevision,
  subscribeLocalDocumentUrls,
} from "@/lib/local-document-url";

/**
 * Resolves a local absolute path to a signed `mains-localdoc://` URL the render
 * host can `fetch()`. Already-signed / http(s) / data / blob URLs pass through.
 * Returns undefined while signing is in flight on the first render for a new
 * path; subsequent renders hit the in-memory cache synchronously.
 */
export function useLocalDocumentUrl(src: string | undefined | null): string | undefined {
  const revision = useSyncExternalStore(subscribeLocalDocumentUrls, localDocumentUrlRevision);
  const key = JSON.stringify([revision, src]);
  const sync = src ? resolveSync(src) : undefined;
  const [asyncEntry, setAsyncEntry] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!src || sync !== undefined) return;
    let cancelled = false;
    signLocalDocument(src).then((next) => {
      if (cancelled || !next) return;
      setAsyncEntry({ key, url: next });
    });
    return () => {
      cancelled = true;
    };
  }, [src, key, sync]);

  if (sync !== undefined) return sync;
  if (asyncEntry && asyncEntry.key === key) return asyncEntry.url;
  return undefined;
}

function resolveSync(src: string): string | undefined {
  if (isPassThroughDocSrc(src)) return src;
  return getCachedSignedDocUrl(src);
}
