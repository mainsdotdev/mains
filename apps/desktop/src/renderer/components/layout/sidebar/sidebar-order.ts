/** Replace only the displayed slots, keeping hidden rows in their original positions. */
export function reorderVisibleIds(
  allIds: readonly string[],
  orderedVisibleIds: readonly string[],
): string[] {
  const visible = new Set(orderedVisibleIds);
  if (visible.size !== orderedVisibleIds.length ||
      allIds.filter((id) => visible.has(id)).length !== orderedVisibleIds.length) {
    return [...allIds];
  }
  let nextVisible = 0;
  return allIds.map((id) =>
    visible.has(id) ? orderedVisibleIds[nextVisible++] : id,
  );
}
