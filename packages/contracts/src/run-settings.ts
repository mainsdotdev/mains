import { CLAUDE_PERMISSION_MODE_IDS, DEFAULT_CLAUDE_PERMISSION_MODE } from "./claude-permission-modes";
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

export interface RunSettingConfig {
  effortLevel?: string;
  modelReasoningEffort?: string;
  permissionMode?: string;
  sandboxMode?: string;
  mode?: string;
  serviceTier?: string;
  thinkingMode?: boolean;
  ultracode?: boolean;
  fastMode?: boolean;
  goalMode?: boolean;
  planMode?: boolean;
}

/** Preferences for the next message, stored in runs.configSnapshot.conversationSettings. */
export interface ConversationSettings {
  model: string;
  config: RunSettingConfig;
}

export function pickRunSettingConfig(config: Record<string, unknown> = {}): RunSettingConfig {
  return Object.fromEntries(RUN_SETTING_CONFIG_KEYS.flatMap((key) => {
    const value = config[key];
    return typeof value === "string" || typeof value === "boolean" ? [[key, value]] : [];
  }));
}

/** Explicit empty/false values keep another chat's provider defaults from leaking in. */
export function snapshotRunSettingConfig(providerId: string, config: Record<string, unknown> = {}): RunSettingConfig {
  const defaults: Record<string, string> = {
    [PROVIDER_IDS.claude]: DEFAULT_CLAUDE_PERMISSION_MODE,
    [PROVIDER_IDS.copilot]: "default",
    [PROVIDER_IDS.codex]: "workspace-write",
    [PROVIDER_IDS.cursor]: "agent",
  };
  const permissionKey = permissionConfigKeyFor(providerId);
  const coupledThinking = providerId === PROVIDER_IDS.codex || providerId === PROVIDER_IDS.copilot;
  const thinkingMode = typeof config.thinking === "boolean" ? config.thinking :
    coupledThinking && !!config.modelReasoningEffort;
  return {
    effortLevel: "", modelReasoningEffort: "", thinkingMode,
    ultracode: false, fastMode: false, serviceTier: "", goalMode: false, planMode: false,
    ...(permissionKey ? { [permissionKey]: defaults[providerId] } : {}),
    ...pickRunSettingConfig(config),
  };
}

export function conversationSettingsFrom(snapshot: Record<string, unknown> | null | undefined): ConversationSettings | null {
  const value = snapshot?.conversationSettings;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const settings = value as ConversationSettings;
  if (typeof settings.model !== "string" || !settings.config || typeof settings.config !== "object" || Array.isArray(settings.config)) return null;
  return { model: settings.model, config: pickRunSettingConfig(settings.config as Record<string, unknown>) };
}
