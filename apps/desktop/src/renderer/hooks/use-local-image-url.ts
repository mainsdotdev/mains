import { useEffect, useState, useSyncExternalStore } from "react";
import type { LocalImagePreviewSize } from "@mains/contracts/image-preview";
import {
  getCachedSignedUrl,
  isPassThroughSrc,
  resolvePassThroughSrc,
  signLocalImage,
  localImageUrlRevision,
  subscribeLocalImageUrls,
} from "@/lib/local-image-url";

/**
 * Resolves a local absolute path to a signed `mains-localimg://` URL. Pass-
 * through schemes are returned as-is, except http(s) URLs which are routed
 * through the `mains-img://` proxy (renderer CSP blocks arbitrary https).
 * Returns undefined while signing is in flight on the first render for a new
 * path — subsequent renders use the in-memory cache and resolve synchronously.
 */
export function useLocalImageUrl(src: string | undefined | null, maxSide?: LocalImagePreviewSize, version?: string | number): string | undefined {
  const revision = useSyncExternalStore(subscribeLocalImageUrls, localImageUrlRevision);
  const key = JSON.stringify([revision, src, maxSide]);
  const sync = src ? resolveSync(src, maxSide) : undefined;
  const [asyncEntry, setAsyncEntry] = useState<{ key: string; url: string } | null>(null);
  const [refreshVersion, refresh] = useState(0);

  useEffect(() => {
    if (!src || sync !== undefined) return;
    let cancelled = false;
    signLocalImage(src, maxSide).then((next) => {
      if (cancelled || !next) return;
      setAsyncEntry({ key, url: next });
    });
    return () => {
      cancelled = true;
    };
  }, [src, maxSide, key, sync, refreshVersion]);

  const url = sync ?? (asyncEntry?.key === key ? asyncEntry.url : undefined);
  useEffect(() => {
    if (!url || !src || isPassThroughSrc(src)) return;
    const expires = Number(new URLSearchParams(url.split("?")[1]).get("exp"));
    if (!expires) return;
    // Lazy images may stay mounted for hours before entering the viewport.
    const timer = setTimeout(() => refresh((value) => value + 1), Math.max(0, expires - Date.now() - 30_000));
    return () => clearTimeout(timer);
  }, [url, src]);
  // Source timestamps refresh browser pixels without repeating path signing.
  if (!url || version === undefined || !src || isPassThroughSrc(src)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function resolveSync(src: string, maxSide?: LocalImagePreviewSize): string | undefined {
  if (isPassThroughSrc(src)) return resolvePassThroughSrc(src);
  return getCachedSignedUrl(src, maxSide);
}
