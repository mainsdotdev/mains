/** Stable identities; display names and slugs may be edited or duplicated. */
export const SEEDED_SPACE_IDS = ["claude", "codex", "copilot", "cursor"] as const;
export type SeededSpaceId = (typeof SEEDED_SPACE_IDS)[number];
export function isSeededSpaceId(id: string): id is SeededSpaceId {
  return (SEEDED_SPACE_IDS as readonly string[]).includes(id);
}
