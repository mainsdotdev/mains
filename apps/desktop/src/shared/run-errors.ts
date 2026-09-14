// ─────────────────────────────────────────────────────────────
// Run-error classification
//
// Failed runs persist the raw driver/SDK failure summary in `runs.lastError`
// (see run-session.finalize). The strings are provider-worded and useless to
// act on programmatically, so this module derives a coarse `RunErrorKind`
// from the message at read time — no schema or event changes. Main and
// renderer both import from here; keep it dependency-free and pure.
// ─────────────────────────────────────────────────────────────

/** Coarse category of a run failure. Extend the union as new kinds earn UI. */
export type RunErrorKind = "auth";

// One pattern per known provider wording, not a generic keyword net — keep
// false positives out of ordinary failure summaries.
const AUTH_ERROR_PATTERNS: RegExp[] = [
  // Claude Code SDK/CLI
  /failed to authenticate/i,
  /oauth (?:session|token).{0,40}expired/i,
  /(?:please )?run \/login/i,
  /invalid api key/i,
  // Copilot (via GitHub CLI)
  /gh auth login/i,
  // Cursor agent (mirrors CURSOR_NOT_LOGGED_IN_RE in cursor.driver.ts)
  /\bnot logged in\b|login required|authentication required/i,
  /\bnot authenticated\b/i,
  // Codex app-server / generic HTTP auth failures
  /\bnot signed in\b/i,
  /\bunauthorized\b|\b401\b/i,
  /authentication (?:failed|error)/i,
  /(?:token|credentials?).{0,30}(?:expired|invalid|revoked)/i,
];

/**
 * Classify a persisted run failure message. Returns null for anything that
 * isn't a recognized kind — callers fall back to showing the raw message.
 */
export function classifyRunErrorKind(
  message: string | null | undefined,
): RunErrorKind | null {
  if (!message) return null;
  return AUTH_ERROR_PATTERNS.some((re) => re.test(message)) ? "auth" : null;
}
