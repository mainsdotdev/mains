/**
 * Canonical provider identifiers used across the IPC boundary, the
 * `providers` DB table primary keys, and the `runs.provider_id` foreign key.
 *
 * Both renderer and main code should import from here instead of repeating
 * the literal — keeps "what does provider X go by?" answered in one place,
 * and lets the type system catch typos like `claude` vs `claude_code`.
 */

export const PROVIDER_IDS = {
  claude: "claude_code",
  copilot: "copilot_cli",
  codex: "codex",
  cursor: "cursor",
} as const;

export type ProviderId = (typeof PROVIDER_IDS)[keyof typeof PROVIDER_IDS];

/**
 * Ordered tuple of all known provider IDs.
 * Order matters for some legacy callers (adapter factory iteration, settings
 * default selection); preserve copilot → claude → codex → cursor.
 */
export const SUPPORTED_PROVIDER_IDS = [
  PROVIDER_IDS.copilot,
  PROVIDER_IDS.claude,
  PROVIDER_IDS.codex,
  PROVIDER_IDS.cursor,
] as const satisfies readonly ProviderId[];

const PROVIDER_ID_SET: ReadonlySet<string> = new Set(SUPPORTED_PROVIDER_IDS);

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_ID_SET.has(value);
}
