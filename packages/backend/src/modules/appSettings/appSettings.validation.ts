import type { AppSettingsPatch } from "./appSettings.dto";

// ─────────────────────────────────────────────────────────────
// Mutable fields allowlist. Anything not in this set is silently
// stripped from incoming patches — guards against callers trying
// to write id/accountId/createdAt/updatedAt.
// ─────────────────────────────────────────────────────────────
const MUTABLE_FIELDS = new Set<keyof AppSettingsPatch>([
  "activeSpaceId",
  "enableWorktrees",
  "showToolCalls",
  "preventSleepDuringRuns",
  "notifyOnRunComplete",
  "notifyOnToolApproval",
  "showMenuBarIcon",
  "commitInstructions",
  "prInstructions",
]);

export function sanitizeAppSettingsPatch(
  patch: unknown,
): AppSettingsPatch | null {
  if (!patch || typeof patch !== "object") return null;
  const out: AppSettingsPatch = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (MUTABLE_FIELDS.has(key as keyof AppSettingsPatch)) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
