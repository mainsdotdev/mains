interface PlaceableChat {
  collectionId: string | null;
  isReplica: boolean;
}

/**
 * Where each chat appears in the sidebar, exactly once (the desktop's
 * `placeChats`, without pins):
 * - its project, when that project is listed here;
 * - Recents otherwise, including another computer's chat whose project this
 *   backend does not list, so it never vanishes.
 */
export function placeChats<T extends PlaceableChat>(
  runs: readonly T[],
  knownCollectionIds: ReadonlySet<string>,
): { standalone: T[]; byCollection: Map<string, T[]> } {
  const standalone: T[] = [];
  const byCollection = new Map<string, T[]>();
  for (const run of runs) {
    const collectionId =
      run.collectionId && (!run.isReplica || knownCollectionIds.has(run.collectionId))
        ? run.collectionId
        : null;
    if (!collectionId) {
      standalone.push(run);
      continue;
    }
    const bucket = byCollection.get(collectionId);
    if (bucket) bucket.push(run);
    else byCollection.set(collectionId, [run]);
  }
  return { standalone, byCollection };
}
