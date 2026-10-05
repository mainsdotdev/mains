import { useEffect, useState, useSyncExternalStore } from "react";
import { CHANNELS } from "@mains/contracts/channels";
import type { ArtifactImage } from "@mains/contracts/runs";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

const CACHE_BYTES = 16 * 1024 * 1024;
const CACHE_ITEMS = 64;
type Entry = { src: string; bytes: number; users: number; revoked: boolean };
export type AttachmentImageLease = { src: string; isActive: () => boolean; release: () => void };
const cached = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
const active = new Set<Entry>();
const listeners = new Set<() => void>();
let backendRevision = 0;

function revoke(entry: Entry): void {
  if (entry.revoked) return;
  entry.revoked = true;
  active.delete(entry);
  URL.revokeObjectURL(entry.src);
}

function prune(): void {
  let bytes = [...cached.values()].reduce((total, entry) => total + entry.bytes, 0);
  for (const [key, entry] of cached) {
    if (bytes <= CACHE_BYTES && cached.size <= CACHE_ITEMS) break;
    if (entry.users) continue;
    cached.delete(key);
    bytes -= entry.bytes;
    revoke(entry);
  }
}

export function clearAttachmentImageCache(): void {
  backendRevision++;
  for (const entry of active) revoke(entry);
  cached.clear();
  pending.clear();
  for (const listener of listeners) listener();
}

onTransportChange(clearAttachmentImageCache);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Only thumbnails are retained. Expanded previews belong to their open modal. */
export async function loadAttachmentImage(runId: string, attachmentId: string, maxSide = 256): Promise<AttachmentImageLease> {
  const revision = backendRevision;
  const transport = getTransport();
  const cacheable = maxSide === 256;
  const key = JSON.stringify([revision, runId, attachmentId, maxSide]);
  let entry = cacheable ? cached.get(key) : undefined;
  if (!entry) {
    let task = cacheable ? pending.get(key) : undefined;
    if (!task) {
      task = (async () => {
        const response = await transport.invoke(CHANNELS.runArtifacts.readAttachmentImage, [{ runId, attachmentId, maxSide }]);
        if (!response.success) throw new Error(response.error);
        if (revision !== backendRevision) throw new Error("Backend changed while loading the image");
        const image = response.data as ArtifactImage;
        const decoded = atob(image.base64);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        const value: Entry = { src: URL.createObjectURL(new Blob([bytes], { type: image.mime })), bytes: bytes.length, users: 0, revoked: false };
        active.add(value);
        if (cacheable) cached.set(key, value);
        return value;
      })();
      if (cacheable) pending.set(key, task);
    }
    try { entry = await task; } finally { if (pending.get(key) === task) pending.delete(key); }
  }
  if (revision !== backendRevision || entry.revoked) throw new Error("Backend changed while loading the image");
  entry.users++;
  if (cacheable) { cached.delete(key); cached.set(key, entry); }
  prune();
  let released = false;
  return {
    src: entry.src,
    isActive: () => !released && !entry.revoked,
    release() {
      if (released) return;
      released = true;
      entry.users--;
      if (!cacheable) revoke(entry);
      prune();
    },
  };
}

/** A placeholder keeps layout stable while offscreen thumbnails hold no pixels. */
export function useAttachmentImage(runId?: string, attachmentId?: string, maxSide = 256, eager = false) {
  const revision = useSyncExternalStore(subscribe, () => backendRevision);
  const [element, setElement] = useState<Element | null>(null);
  const [intersecting, setIntersecting] = useState(false);
  const visible = eager || typeof IntersectionObserver === "undefined" || intersecting;
  const [image, setImage] = useState<{ lease?: AttachmentImageLease; error?: string; key: string }>({ key: "" });
  const key = JSON.stringify([revision, runId, attachmentId, maxSide]);

  useEffect(() => {
    if (eager || typeof IntersectionObserver === "undefined" || !element) return;
    const observer = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, eager]);

  useEffect(() => {
    if (!visible || !runId || !attachmentId) return;
    let canceled = false;
    let lease: AttachmentImageLease | undefined;
    loadAttachmentImage(runId, attachmentId, maxSide).then((result) => {
      if (canceled) { result.release(); return; }
      lease = result;
      setImage({ key, lease: result });
    }, (error: unknown) => {
      if (!canceled) setImage({ key, error: error instanceof Error ? error.message : "Could not load image" });
    });
    return () => { canceled = true; lease?.release(); };
  }, [runId, attachmentId, maxSide, visible, key]);

  return { observe: setElement, src: visible && image.key === key && image.lease?.isActive() ? image.lease.src : undefined, error: image.key === key ? image.error : undefined };
}
