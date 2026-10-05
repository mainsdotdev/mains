import { useEffect, useState, useSyncExternalStore } from "react";
import { backendSession } from "@/backend/backend-session";
import type { PromptImage } from "@/lib/transcript";

const MAX_ITEMS = 64;
const MAX_BYTES = 16 * 1024 * 1024;
const cached = new Map<string, { promise: Promise<string>; bytes: number }>();
let cachedBackendId: string | undefined;

function prune(): void {
  let bytes = [...cached.values()].reduce((total, value) => total + value.bytes, 0);
  for (const [key, value] of cached) {
    if (cached.size <= MAX_ITEMS && bytes <= MAX_BYTES) break;
    cached.delete(key);
    bytes -= value.bytes;
  }
}

function loadPromptImage(runId: string, attachmentId: string): Promise<string> {
  const backendId = backendSession.getSnapshot().backend?.backendId;
  if (backendId !== cachedBackendId) { cached.clear(); cachedBackendId = backendId; }
  const key = JSON.stringify([backendId, runId, attachmentId]);
  const hit = cached.get(key);
  if (hit) { cached.delete(key); cached.set(key, hit); return hit.promise; }
  const entry = { promise: Promise.resolve(""), bytes: 0 };
  entry.promise = backendSession.readAttachmentImage(runId, attachmentId).then((image) => {
    if (backendId !== backendSession.getSnapshot().backend?.backendId) throw new Error("Backend changed");
    const uri = `data:${image.mime};base64,${image.base64}`;
    entry.bytes = uri.length * 2;
    prune();
    return uri;
  }).catch((error: unknown) => {
    if (cached.get(key) === entry) cached.delete(key);
    throw error;
  });
  cached.set(key, entry);
  prune();
  return entry.promise;
}

// Drop pixels as soon as another computer is selected, including while no
// transcript is mounted. Cache keys never cross a paired-backend boundary.
backendSession.subscribe(() => {
  const next = backendSession.getSnapshot().backend?.backendId;
  if (next !== cachedBackendId) { cached.clear(); cachedBackendId = next; }
});

export function usePromptImageUri(image: PromptImage): string | undefined {
  const session = useSyncExternalStore(backendSession.subscribe, backendSession.getSnapshot);
  const key = JSON.stringify([session.backend?.backendId, image.runId, image.attachmentId]);
  const [loaded, setLoaded] = useState<{ key: string; uri: string } | null>(null);
  useEffect(() => {
    if (image.uri || !image.runId || !image.attachmentId) return;
    let canceled = false;
    loadPromptImage(image.runId, image.attachmentId).then((uri) => {
      if (!canceled) setLoaded({ key, uri });
    }).catch(() => { /* the existing tile background is the unavailable placeholder */ });
    return () => { canceled = true; };
  }, [image.uri, image.runId, image.attachmentId, key, session.connection.kind]);
  return image.uri ?? (loaded?.key === key ? loaded.uri : undefined);
}
