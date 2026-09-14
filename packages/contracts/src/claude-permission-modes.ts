/**
 * Claude's permission modes and the one Mains starts new installs on.
 *
 * The default lived in four places that had drifted apart — the provider seed,
 * the driver's fallback, the settings screen's fallback, and the renderer's
 * variant descriptor — with the settings screen claiming a different mode than
 * runs actually used. Both renderer and main import from here so there is one
 * answer, the way `provider-ids.ts` and `modes.ts` already do.
 *
 * Display labels are a renderer concern and live in `lib/provider-modes.ts`.
 */

export const CLAUDE_PERMISSION_MODE_IDS = [
  "default",
  "auto",
  "acceptEdits",
  "plan",
  "bypassPermissions",
  "dontAsk",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODE_IDS)[number];

/**
 * What a fresh install starts on. Applied by the provider seed, which uses
 * `onConflictDoNothing`, so changing this never overrides a mode an existing
 * user already chose.
 */
export const DEFAULT_CLAUDE_PERMISSION_MODE: ClaudePermissionMode = "auto";

const CLAUDE_PERMISSION_MODE_SET: ReadonlySet<string> = new Set(
  CLAUDE_PERMISSION_MODE_IDS,
);

export function isClaudePermissionMode(
  value: unknown,
): value is ClaudePermissionMode {
  return typeof value === "string" && CLAUDE_PERMISSION_MODE_SET.has(value);
}
