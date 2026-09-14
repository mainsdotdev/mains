import { useEffect, useState } from "react";
import {
  getCachedSignedUrl,
  isPassThroughSrc,
  resolvePassThroughSrc,
  signLocalImage,
} from "@/lib/local-image-url";

/**
 * Resolves a local absolute path to a signed `mains-localimg://` URL. Pass-
 * through schemes are returned as-is, except http(s) URLs which are routed
 * through the `mains-img://` proxy (renderer CSP blocks arbitrary https).
 * Returns undefined while signing is in flight on the first render for a new
 * path — subsequent renders use the in-memory cache and resolve synchronously.
 */
export function useLocalImageUrl(src: string | undefined | null): string | undefined {
  const sync = src ? resolveSync(src) : undefined;
  const [asyncEntry, setAsyncEntry] = useState<{ src: string; url: string } | null>(null);

  useEffect(() => {
    if (!src || sync !== undefined) return;
    let cancelled = false;
    signLocalImage(src).then((next) => {
      if (cancelled || !next) return;
      setAsyncEntry({ src, url: next });
    });
    return () => {
      cancelled = true;
    };
  }, [src, sync]);

  if (sync !== undefined) return sync;
  if (asyncEntry && asyncEntry.src === src) return asyncEntry.url;
  return undefined;
}

function resolveSync(src: string): string | undefined {
  if (isPassThroughSrc(src)) return resolvePassThroughSrc(src);
  return getCachedSignedUrl(src);
}
