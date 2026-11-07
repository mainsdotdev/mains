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
  "atlasAutoTagging",
]);

export function sanitizeAppSettingsPatch(
  patch: unknown,
): AppSettingsPatch | null {
  if (!patch || typeof patch !== "object") return null;
  const out: AppSettingsPatch = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (MUTABLE_FIELDS.has(key as keyof AppSettingsPatch)) {
      if (key === "atlasAutoTagging") {
        if (typeof value !== "string" || value.length > 2048) throw new Error("Invalid automatic tagging settings");
        const config = JSON.parse(value);
        if (!config || typeof config.enabled !== "boolean" || typeof config.providerId !== "string"
          || typeof config.model !== "string" || config.providerId.length > 128 || config.model.length > 256
          || (config.enabled && (!config.providerId.trim() || !config.model.trim())))
          throw new Error("Choose a provider and model for automatic tagging");
      }
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
