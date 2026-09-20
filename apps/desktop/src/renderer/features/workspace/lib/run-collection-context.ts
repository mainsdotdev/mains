import type { ModeId } from "../../../../shared/modes";

interface CollectionRun {
  id: string;
  collectionId?: string | null;
}

/**
 * Returns the collection that may be copied from the visible run into the
 * next-send state. `undefined` means the current screen must not sync it.
 */
export function collectionIdForVisibleRun(
  mode: ModeId,
  activeTab: string,
  activeRun: CollectionRun | undefined,
): string | null | undefined {
  if (
    mode === "developer" ||
    !activeRun ||
    activeTab !== activeRun.id
  ) {
    return undefined;
  }
  return activeRun.collectionId ?? null;
}

/** Keeps a skipped RTK query's retained data out of a standalone new chat. */
export function projectForNewChat<T extends { id: string }>(
  mode: ModeId,
  selectedCollectionId: string | null,
  cachedCollection: T | null | undefined,
): T | undefined {
  if (
    mode === "developer" ||
    !selectedCollectionId ||
    cachedCollection?.id !== selectedCollectionId
  ) {
    return undefined;
  }
  return cachedCollection;
}
