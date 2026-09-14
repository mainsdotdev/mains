import { ICON_SHAPES } from "./shapes.generated";

/**
 * The data half of the desktop icon registry
 * (`apps/desktop/src/renderer/lib/icon-registry.tsx`). Spaces and projects store
 * their icon as `icon:<name>|<color>` or `emoji:<emoji>` (legacy rows hold a
 * bare registry name or a raw emoji); the shapes themselves live in the
 * generated file next to this one, produced from the desktop SVG components
 * by `scripts/sync-icon-registry.mjs`.
 */

export interface IconPath {
  d: string;
  fillRule?: "evenodd" | "nonzero";
  clipRule?: "evenodd" | "nonzero";
}

export interface IconShape {
  viewBox: string;
  paths: IconPath[];
}

export type ParsedIcon =
  | { type: "emoji"; value: string }
  | { type: "icon"; name: string; shape: IconShape; color?: string };

/**
 * Provider marks stay in the registry so `icon:claude` keeps resolving, but
 * the desktop never offers them as a pick — a space showing one is the
 * seeded default rather than a user choice.
 */
export const PROVIDER_ICON_NAMES = new Set(["claude", "copilot", "codex", "cursor"]);

export function iconShape(name: string): IconShape | undefined {
  return ICON_SHAPES[name];
}

/** The `<name>|<color>` token; color is optional. */
function splitToken(token: string): { name: string; color?: string } {
  const [name, color] = token.split("|");
  return { name: name.trim().toLowerCase(), color: color?.trim().toLowerCase() || undefined };
}

/**
 * Mirrors the desktop `parseIcon`, except that nothing / unknown resolves to
 * `null` rather than a stand-in emoji, so callers can draw their own fallback
 * (an initial, a folder) in the surface's style.
 */
export function parseIcon(stored: string | null | undefined): ParsedIcon | null {
  if (!stored) return null;
  if (stored.startsWith("emoji:")) {
    const value = stored.slice("emoji:".length);
    return value ? { type: "emoji", value } : null;
  }
  const explicit = stored.startsWith("icon:");
  const { name, color } = splitToken(explicit ? stored.slice("icon:".length) : stored);
  const shape = ICON_SHAPES[name];
  if (shape) return { type: "icon", name, shape, color };
  return explicit ? null : { type: "emoji", value: stored };
}

/**
 * Tints a user can put on a registry icon, keyed by the desktop's stored color
 * names. Light and dark shades are the desktop's Tailwind tokens
 * (`text-pink-600 dark:text-pink-500`, …) resolved to hex.
 */
const ICON_TINTS: Record<string, { light: string; dark: string }> = {
  pink: { light: "#e60076", dark: "#f6339a" },
  red: { light: "#fb2c36", dark: "#ff6467" },
  orange: { light: "#ff6900", dark: "#ff8904" },
  amber: { light: "#fe9a00", dark: "#ffd230" },
  green: { light: "#7ccf00", dark: "#9ae600" },
  blue: { light: "#2b7fff", dark: "#51a2ff" },
  purple: { light: "#615fff", dark: "#7c86ff" },
};

/** The hex for a stored tint name; `undefined` for default / unknown. */
export function iconTint(color: string | undefined, scheme: "light" | "dark"): string | undefined {
  if (!color) return undefined;
  return ICON_TINTS[color]?.[scheme];
}
