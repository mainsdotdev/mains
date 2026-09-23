import { useCallback, useSyncExternalStore } from "react";
import type { UploadedFile } from "@/components/ui";

// File and blob: URLs cannot be JSON persisted. This store survives route
// unmounts, and disappears with the renderer when the app closes or reloads.
const EMPTY: UploadedFile[] = [];
const filesByOwner = new Map<string, UploadedFile[]>();
const listeners = new Map<string, Set<() => void>>();

function subscribe(owner: string, listener: () => void): () => void {
  const group = listeners.get(owner) ?? new Set<() => void>();
  group.add(listener);
  listeners.set(owner, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(owner);
  };
}

function getFiles(owner: string): UploadedFile[] {
  return filesByOwner.get(owner) ?? EMPTY;
}

function replaceFiles(owner: string, next: UploadedFile[]): void {
  const previous = getFiles(owner);
  for (const file of previous) {
    if (file.preview && !next.includes(file)) URL.revokeObjectURL(file.preview);
  }
  if (next.length) filesByOwner.set(owner, next);
  else filesByOwner.delete(owner);
  listeners.get(owner)?.forEach((listener) => listener());
}

export function useTransientUploads(owner: string) {
  const files = useSyncExternalStore(
    useCallback((listener) => subscribe(owner, listener), [owner]),
    useCallback(() => getFiles(owner), [owner]),
  );
  const setFiles = useCallback((next: UploadedFile[]) => replaceFiles(owner, next), [owner]);
  return [files, setFiles] as const;
}
