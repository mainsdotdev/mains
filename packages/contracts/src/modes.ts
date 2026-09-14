/**
 * Canonical mode identifiers — the "experience" a space drives: developer
 * (coding agent), work (knowledge-work agent), chat (plain conversation).
 *
 * A mode decides how the app looks and behaves around the agent (sidebar,
 * right panel, default route, and later: prompt deltas, permission defaults),
 * while `providerId` decides which agent engine runs underneath. The two are
 * deliberately orthogonal — a work space can be driven by any provider.
 *
 * Mirrors `provider-ids.ts`: both renderer and main import from here so the
 * literal lives in one place and typos die at compile time.
 */

import { PROVIDER_IDS, type ProviderId } from "./provider-ids";

export const MODE_IDS = ["developer", "work", "chat"] as const;

export type ModeId = (typeof MODE_IDS)[number];

export const DEFAULT_MODE_ID: ModeId = "developer";

const MODE_ID_SET: ReadonlySet<string> = new Set(MODE_IDS);

export function isModeId(value: unknown): value is ModeId {
  return typeof value === "string" && MODE_ID_SET.has(value);
}

// ─────────────────────────────────────────────────────────────
// Which experiences each provider drives
// ─────────────────────────────────────────────────────────────

/**
 * Work and Chat ask an agent to behave as a knowledge-work collaborator, which
 * takes more than a prompt delta: a tone lever, a way to constrain commands,
 * and a UI that hides the developer ceremony. Claude and Codex have those.
 * Copilot CLI and Cursor are code-first agents whose harnesses don't yet, so
 * they stay on Developer — the mode picker doesn't offer the others and the
 * service refuses to store them.
 *
 * Reversing this is one line per provider: the harness table already carries
 * their work/chat entries, unused, waiting.
 */
export const PROVIDER_MODES: Record<ProviderId, readonly ModeId[]> = {
  [PROVIDER_IDS.claude]: MODE_IDS,
  [PROVIDER_IDS.codex]: MODE_IDS,
  [PROVIDER_IDS.copilot]: ["developer"],
  [PROVIDER_IDS.cursor]: ["developer"],
};

/** Modes a provider offers. An id outside the union is left unrestricted. */
export function providerModes(providerId: string): readonly ModeId[] {
  return PROVIDER_MODES[providerId as ProviderId] ?? MODE_IDS;
}

export function providerSupportsMode(providerId: string, mode: ModeId): boolean {
  return providerModes(providerId).includes(mode);
}

/**
 * The mode a provider can actually run, given a stored one. Rows written before
 * a provider narrowed its list read back as the default rather than rendering
 * an experience the provider no longer drives.
 */
export function clampModeForProvider(
  providerId: string,
  mode: ModeId | null | undefined,
): ModeId {
  const resolved = isModeId(mode) ? mode : DEFAULT_MODE_ID;
  return providerSupportsMode(providerId, resolved) ? resolved : DEFAULT_MODE_ID;
}
