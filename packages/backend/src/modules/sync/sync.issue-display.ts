// ─────────────────────────────────────────────────────────────
// Provider fields → the shared issue row
//
// Every fetcher fills the same display fields (identifier, priority, label
// colors, group, assignee avatar, due date) so the Tasks inbox draws one row
// for every provider. These helpers turn each provider's own formats into
// the shared ones.
// ─────────────────────────────────────────────────────────────

/** Linear's priority scale, which the `issues.priority` column uses for everyone. */
export const PRIORITY = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 } as const;

// First match wins: "Highest" before "High", "Lowest" before "Low".
const PRIORITY_NAMES: ReadonlyArray<[RegExp, number]> = [
  [/urgent|highest|blocker|critical|\bp0\b/, PRIORITY.urgent],
  [/high|major|\bp1\b/, PRIORITY.high],
  [/medium|normal|\bp2\b/, PRIORITY.medium],
  [/low|minor|trivial|\bp[34]\b/, PRIORITY.low],
];

/** A priority given by name (Jira "Highest", an Asana "Priority" field's "High"). */
export function priorityFromName(name: string | null | undefined): number {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return PRIORITY.none;
  return PRIORITY_NAMES.find(([pattern]) => pattern.test(normalized))?.[1] ?? PRIORITY.none;
}

/** Trello's label palette, by base name ("green_dark" → "green"). */
const TRELLO_COLORS: Record<string, string> = {
  green: "#4bce97",
  yellow: "#f5cd47",
  orange: "#fea362",
  red: "#f87168",
  purple: "#9f8fef",
  blue: "#579dff",
  sky: "#6cc3e0",
  lime: "#94c748",
  pink: "#e774bb",
  black: "#8590a2",
};

/** Asana's tag palette, by base name ("dark-pink", "light-green", "hot-pink"). */
const ASANA_COLORS: Record<string, string> = {
  red: "#e8384f",
  orange: "#fd612c",
  "yellow-orange": "#fd9a00",
  yellow: "#eec300",
  "yellow-green": "#a4cf30",
  green: "#62d26f",
  "blue-green": "#37c5ab",
  teal: "#37c5ab",
  aqua: "#20aaea",
  blue: "#4186e0",
  indigo: "#7a6ff0",
  purple: "#aa62e3",
  magenta: "#e362e3",
  "hot-pink": "#ea4e9d",
  pink: "#fc91ad",
  brown: "#a0784a",
  "cool-gray": "#8da3a6",
  "warm-gray": "#8d8d8d",
};

/**
 * Any provider's color as "#rrggbb", or null: Linear/GitLab hex, GitHub hex
 * without "#", and the named palettes of Trello and Asana.
 */
export function hexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const hex = value.startsWith("#") ? value : `#${value}`;
  if (/^#[\da-f]{6}$/.test(hex)) return hex;
  if (/^#[\da-f]{3}$/.test(hex)) {
    return `#${[...hex.slice(1)].map((c) => c + c).join("")}`;
  }
  const trello = TRELLO_COLORS[value.replace(/_(dark|light)$/, "")];
  if (trello) return trello;
  return ASANA_COLORS[value.replace(/^(dark|light)-/, "")] ?? null;
}

/** `{ name → color }` for the labels that have one, as `issues.label_colors` stores it. */
export function labelColorMap(
  labels: ReadonlyArray<{ name?: string | null; color?: string | null }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const label of labels) {
    const color = hexColor(label.color);
    if (label.name && color) map[label.name] = color;
  }
  return map;
}
