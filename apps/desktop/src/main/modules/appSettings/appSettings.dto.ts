import type { appSettings } from "../../db/schema";

// ─────────────────────────────────────────────────────────────
// Database Record
// ─────────────────────────────────────────────────────────────
export type AppSettingsRecord = typeof appSettings.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Patch — only mutable fields. id/accountId/createdAt/updatedAt
// are owned by the module and stripped from any incoming patch.
// ─────────────────────────────────────────────────────────────
export type AppSettingsPatch = Partial<{
  activeSpaceId: string | null;
  enableWorktrees: boolean;
  showToolCalls: boolean;
  preventSleepDuringRuns: boolean;
  notifyOnRunComplete: boolean;
  notifyOnToolApproval: boolean;
  showMenuBarIcon: boolean;
  backendRemoteAccess: boolean;
  backendLanAccess: boolean;
  backendTailscaleHttps: boolean;
  backendId: string | null;
  commitInstructions: string;
  prInstructions: string;
}>;

