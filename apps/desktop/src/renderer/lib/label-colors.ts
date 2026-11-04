export function parseLabels(labels: string | null): string[] {
  if (!labels) return [];
  try {
    const parsed = JSON.parse(labels);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Mid tones that read on both light and dark backgrounds. */
const LABEL_PALETTE = [
  "#5e6ad2",
  "#4ea7fc",
  "#26b5ce",
  "#4cb782",
  "#f2c94c",
  "#f2994a",
  "#eb5757",
  "#e563a7",
  "#bb87fc",
];

/**
 * A label's color, picked from its name: the same label is always the same
 * color, whichever connection it comes from ("Bug" on Linear, "bug" on
 * GitHub).
 */
export function labelColor(name: string): string {
  const key = name.trim().toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return LABEL_PALETTE[(hash >>> 0) % LABEL_PALETTE.length];
}
