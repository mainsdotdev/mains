export function moveCollectionId(
  ids: readonly string[],
  sourceId: string,
  targetId: string,
  edge: "before" | "after",
): string[] {
  if (
    sourceId === targetId ||
    !ids.includes(sourceId) ||
    !ids.includes(targetId)
  ) {
    return [...ids];
  }
  const next = ids.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, sourceId);
  return next;
}
