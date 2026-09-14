import { CLAUDE_PERMISSION_MODE_IDS } from "./claude-permission-modes";
import { PROVIDER_IDS, type ProviderId } from "./provider-ids";

/**
 * The permission / sandbox mode each provider accepts, and the config key it
 * lives under. Ids only — labels are a renderer concern
 * (`lib/provider-modes.ts`). Copilot reads the shared four; Claude's list
 * adds `auto` and `dontAsk`, which Copilot's driver has no branch for.
 */
export const PERMISSION_MODE_IDS: Record<ProviderId, readonly string[]> = {
  [PROVIDER_IDS.claude]: CLAUDE_PERMISSION_MODE_IDS,
  [PROVIDER_IDS.copilot]: ["default", "acceptEdits", "plan", "bypassPermissions"],
  [PROVIDER_IDS.codex]: ["read-only", "workspace-write", "danger-full-access"],
  [PROVIDER_IDS.cursor]: ["ask", "agent", "plan"],
};

export const PERMISSION_CONFIG_KEY: Record<ProviderId, string> = {
  [PROVIDER_IDS.claude]: "permissionMode",
  [PROVIDER_IDS.copilot]: "permissionMode",
  [PROVIDER_IDS.codex]: "sandboxMode",
  [PROVIDER_IDS.cursor]: "mode",
};

export function permissionModeIdsFor(providerId: string): readonly string[] {
  return PERMISSION_MODE_IDS[providerId as ProviderId] ?? [];
}

export function permissionConfigKeyFor(providerId: string): string | null {
  return PERMISSION_CONFIG_KEY[providerId as ProviderId] ?? null;
}

/**
 * The provider-config keys the composer's run settings live under — and the
 * only config keys a paired device is shown (the desktop's
 * `providerForPairedDevice`): everything else in the blob, apiKey and baseUrl
 * first of all, never leaves the Mac.
 */
export const RUN_SETTING_CONFIG_KEYS = [
  "effortLevel",
  "thinkingMode",
  "ultracode",
  "modelReasoningEffort",
  "permissionMode",
  "sandboxMode",
  "mode",
  "fastMode",
  "serviceTier",
  "goalMode",
  "planMode",
] as const;
