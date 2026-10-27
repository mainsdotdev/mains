interface PlaceableChat {
  collectionId: string | null;
  pinnedAt: unknown;
  isReplica?: boolean;
}

/**
 * Where each chat appears in the chat shell's sidebar, exactly once:
 * - Pinned: this device's pinned chats (pins belong to the owning device);
 * - its project, when that project exists here;
 * - Recents otherwise, including another device's chat whose project this
 *   device does not have, so it never vanishes.
 */
export function placeChats<T extends PlaceableChat>(runs: readonly T[], knownCollectionIds: ReadonlySet<string>) {
  const pinned: T[] = [], standalone: T[] = [], byCollection = new Map<string, T[]>();
  for (const run of runs) {
    if (run.pinnedAt != null && !run.isReplica) { pinned.push(run); continue; }
    const collectionId = run.collectionId && (!run.isReplica || knownCollectionIds.has(run.collectionId)) ? run.collectionId : null;
    if (!collectionId) { standalone.push(run); continue; }
    const bucket = byCollection.get(collectionId);
    if (bucket) bucket.push(run); else byCollection.set(collectionId, [run]);
  }
  return { pinned, standalone, byCollection };
}
