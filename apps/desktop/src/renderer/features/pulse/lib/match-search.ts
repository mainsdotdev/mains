/**
 * Loose search for the Pulse page: every whitespace-separated term in `query`
 * must appear somewhere in `fields`, case-insensitively. An empty query
 * matches everything.
 */
export function matchesSearch(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
