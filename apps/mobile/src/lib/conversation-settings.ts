import {
  conversationSettingsFrom,
  permissionConfigKeyFor,
  pickRunSettingConfig,
  snapshotRunSettingConfig,
  type ConversationSettings,
} from "@mains/contracts/run-settings";
import type { UpdateRunSettingsPayload } from "@mains/contracts/runs";
import { parseEffortLevels, parseServiceTiers, pickDefaultEffort, runSettingsFromConfig } from "./models";

export type ComposerSettingsPatch = UpdateRunSettingsPayload & { model?: string; serviceTier?: string };

/** A deliberate model selection must carry compatible effort and speed together. */
export function modelSelectionPatch(providerId: string, settings: ConversationSettings, model: {
  id: string; effortLevels: string | null; serviceTiersJson: string | null; supportsFastMode: boolean;
}): ComposerSettingsPatch {
  const patch: ComposerSettingsPatch = { model: model.id };
  const current = runSettingsFromConfig(providerId, settings.config as Record<string, unknown>).effortLevel;
  const levels = parseEffortLevels(model.effortLevels);
  if (levels.length > 0 && current && current !== "ultracode" && !levels.includes(current)) {
    patch.effortLevel = pickDefaultEffort(levels, current);
  }
  if (providerId === "codex") {
    const tiers = parseServiceTiers(model.serviceTiersJson).map((tier) => tier.id);
    if (!tiers.length && model.supportsFastMode) tiers.push("fast");
    const currentTier = settings.config.serviceTier;
    const tier = currentTier === "priority" && tiers.includes("fast") ? "fast" : currentTier;
    if (tier && tier !== "default" && !tiers.includes(tier)) patch.serviceTier = "default";
    else if (tier !== currentTier) patch.serviceTier = tier;
  }
  return patch;
}

export function parseSettings(json: string | null | undefined): ConversationSettings | null {
  try {
    return json ? conversationSettingsFrom({ conversationSettings: JSON.parse(json) }) : null;
  } catch {
    return null;
  }
}

export function parseConfig(json: string | null | undefined): Record<string, unknown> {
  try {
    const value: unknown = json ? JSON.parse(json) : null;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Persist just composer preferences; runtime paths and credentials never enter the phone cache. */
export function projectRunConfig(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const settings = conversationSettingsFrom(snapshot);
  return {
    ...pickRunSettingConfig(snapshot ?? {}),
    ...(settings ? { conversationSettings: settings } : {}),
  };
}

export function initialConversationSettings({ providerId, providerConfig, run, latestModel, draft, remembered, defaultModel }: {
  providerId: string;
  providerConfig: Record<string, unknown>;
  run?: { model: string | null; configSnapshotJson: string | null } | null;
  latestModel?: string | null;
  draft?: ConversationSettings | null;
  remembered?: ConversationSettings | null;
  defaultModel: string;
}): ConversationSettings {
  if (run) {
    const snapshot = parseConfig(run.configSnapshotJson);
    return conversationSettingsFrom(snapshot) ?? {
      model: latestModel || run.model || "",
      config: snapshotRunSettingConfig(providerId, {
        ...providerConfig, ...pickRunSettingConfig(snapshot),
      }),
    };
  }
  if (draft) return draft;
  const settings = remembered ?? {
    model: defaultModel,
    config: snapshotRunSettingConfig(providerId, providerConfig),
  };
  return { ...settings, config: { ...settings.config, goalMode: false, planMode: false } };
}

/** Translate the native sheet's labels into the same config keys the desktop sends. */
export function patchConversationSettings(providerId: string, settings: ConversationSettings, patch: ComposerSettingsPatch): ConversationSettings {
  const config = { ...settings.config };
  if (patch.effortLevel !== undefined) {
    const level = patch.effortLevel;
    if (providerId === "codex" || providerId === "copilot_cli") {
      config.modelReasoningEffort = level;
      config.thinkingMode = !!level;
    } else if (providerId === "claude_code" && level === "ultracode") {
      config.ultracode = true;
      config.thinkingMode = true;
    } else {
      config.effortLevel = level;
      config.thinkingMode = !!level;
      config.ultracode = false;
    }
  }
  if (patch.permissionMode !== undefined) {
    const key = permissionConfigKeyFor(providerId);
    if (key) Object.assign(config, { [key]: patch.permissionMode });
  }
  if (patch.fastMode !== undefined) {
    if (providerId === "codex") config.serviceTier = patch.fastMode ? "fast" : "default";
    else config.fastMode = patch.fastMode;
  }
  if (patch.goalMode !== undefined) {
    config.goalMode = patch.goalMode;
    if (patch.goalMode) config.planMode = false;
  }
  if (patch.serviceTier !== undefined) config.serviceTier = patch.serviceTier;
  if (patch.planMode !== undefined) {
    config.planMode = patch.planMode;
    if (patch.planMode) config.goalMode = false;
  }
  return { model: patch.model ?? settings.model, config };
}
