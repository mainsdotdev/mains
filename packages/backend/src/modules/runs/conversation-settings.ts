import {
  conversationSettingsFrom, snapshotRunSettingConfig, pickRunSettingConfig,
  permissionConfigKeyFor, permissionModeIdsFor, RUN_SETTING_CONFIG_KEYS,
  type ConversationSettings,
} from "@mains/contracts/run-settings";
import { isEffortLevel } from "@mains/contracts/effort-levels";
import { PROVIDER_IDS } from "@mains/contracts/provider-ids";

export function validateConversationSettings(providerId: string, value: ConversationSettings): ConversationSettings {
  if (!value || typeof value.model !== "string" || value.model.length > 512 ||
      !value.config || typeof value.config !== "object" || Array.isArray(value.config)) {
    throw new Error("Invalid conversation settings");
  }
  const booleanKeys = new Set(["thinkingMode", "ultracode", "fastMode", "goalMode", "planMode"]);
  for (const [key, setting] of Object.entries(value.config)) {
    if (!(RUN_SETTING_CONFIG_KEYS as readonly string[]).includes(key) ||
        typeof setting !== (booleanKeys.has(key) ? "boolean" : "string")) {
      throw new Error(`Invalid conversation setting "${key}"`);
    }
  }
  const permissionKey = permissionConfigKeyFor(providerId);
  const permission = permissionKey ? value.config[permissionKey as keyof typeof value.config] : undefined;
  if (permission !== undefined && !permissionModeIdsFor(providerId).includes(String(permission))) {
    throw new Error(`Unknown permission mode "${permission}" for ${providerId}`);
  }
  // Codex validates its model/effort pair in the app-server; its model catalog
  // can advertise identifiers that this app does not know yet.
  if (providerId !== PROVIDER_IDS.codex) {
    for (const level of [value.config.effortLevel, value.config.modelReasoningEffort]) {
      if (level && !isEffortLevel(level)) {
        throw new Error(`Unknown effort level "${level}"`);
      }
    }
  }
  return { model: value.model.trim(), config: pickRunSettingConfig(value.config as Record<string, unknown>) };
}

export function resolveConversationSettings(
  providerId: string,
  providerConfig: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null | undefined,
  previousModel: string | null | undefined,
  requested?: ConversationSettings,
): ConversationSettings {
  const saved = conversationSettingsFrom(snapshot);
  const selected = requested ? validateConversationSettings(providerId, requested) : saved;
  return {
    model: selected?.model || previousModel || String(providerConfig?.defaultModel ?? ""),
    config: snapshotRunSettingConfig(providerId, {
      ...providerConfig,
      ...pickRunSettingConfig(snapshot ?? {}),
      ...saved?.config,
      ...selected?.config,
    }),
  };
}
