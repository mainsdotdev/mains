import { useCallback, useSyncExternalStore } from "react";
import type { UploadedFile } from "@/components/ui";
import { isWorkspaceDraftOwnerKey } from "../../../../shared/ui-state-keys";
import { transientDocumentFiles } from "../lib/document-lifecycle";

// File and blob: URLs cannot be JSON persisted. This store survives route
// unmounts, and disappears with the renderer when the app closes or reloads.

export function setTransientUploadsForOwner(owner: string, files: UploadedFile[]): void {
  transientDocumentFiles.replace(owner, files);
}

export function getTransientUploadsForOwner(owner: string): UploadedFile[] {
  return transientDocumentFiles.get(owner);
}

/** Retarget an unsent draft without revoking the previews that move with it. */
export function moveTransientUploadsToOwner(from: string, to: string, options?: { merge?: boolean }): void {
  transientDocumentFiles.move(from, to, options);
}

export function clearTransientUploads(owner: string): void {
  transientDocumentFiles.replace(owner, []);
}

export function clearWorkspaceTransientUploads(backendId: string, workspaceId: string): void {
  for (const owner of transientDocumentFiles.owners()) {
    if (isWorkspaceDraftOwnerKey(owner, backendId, workspaceId)) clearTransientUploads(owner);
  }
}

export function useTransientUploads(owner: string) {
  const files = useSyncExternalStore(
    useCallback((listener) => transientDocumentFiles.subscribe(owner, listener), [owner]),
    useCallback(() => transientDocumentFiles.get(owner), [owner]),
  );
  const setFiles = useCallback((next: UploadedFile[]) => transientDocumentFiles.replace(owner, next), [owner]);
  return [files, setFiles] as const;
}
