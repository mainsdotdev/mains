import { and, asc, eq } from "drizzle-orm";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";

import { useSession } from "@/backend/backend-session";
import { db } from "@/db/client";
import { models, spaces } from "@/db/schema";
import { composerModeControls } from "./composer-mode";
import { useRunSettings } from "./use-run-settings";

import {
  dedupeModelsByPrettyName,
  formatEffortLevel,
  modelPrettyName,
  parseEffortLevels,
  parseServiceTiers,
  permissionModesFor,
  permissionShortLabel,
  runSettingsFromConfig,
} from "./models";

/**
 * What the composer's model pill and the model sheet both need for one
 * conversation: its saved model and next-message preferences. Without a run
 * id these are the phone's draft preferences for a new conversation.
 */
export function useModelSelection(backendId: string, providerId: string, runId?: string | null) {
  const { selectedSpaceId } = useSession();
  const spaceQuery = useCoalescedLiveQuery(
    db.select({ mode: spaces.mode }).from(spaces).where(and(
      eq(spaces.backendId, backendId), eq(spaces.id, selectedSpaceId ?? ""), eq(spaces.providerId, providerId),
    )).limit(1), spaces, [backendId, selectedSpaceId, providerId],
  );
  const modelQuery = useCoalescedLiveQuery(
    db
      .select()
      .from(models)
      .where(and(eq(models.backendId, backendId), eq(models.providerId, providerId)))
      .orderBy(asc(models.sortOrder)),
    models,
    [backendId, providerId],
  );
  const conversation = useRunSettings(backendId, providerId, runId, modelQuery.data.find((model) => model.isDefault)?.id ?? modelQuery.data[0]?.id ?? "");
  const controls = composerModeControls({ providerId, runId, runMode: conversation.mode, draftMode: spaceQuery.data[0]?.mode });
  const choice = conversation.settings.model;
  const list = dedupeModelsByPrettyName(modelQuery.data, providerId, choice);
  const selected =
    list.find((m) => m.id === choice) ?? (choice ? {
      backendId, providerId, id: choice, displayName: choice, description: null,
      isDefault: false, effortLevels: null, supportsFastMode: false, serviceTiersJson: null, sortOrder: -1,
    } : null);
  const settings = runSettingsFromConfig(providerId, conversation.settings.config as Record<string, unknown>);
  const effortLevel = settings.effortLevel;
  const supportedLevels = parseEffortLevels(selected?.effortLevels);
  const permissionMode = settings.permissionMode;
  const serviceTiers = parseServiceTiers(selected?.serviceTiersJson).filter((tier) => tier.id !== "default");
  const storedTier = conversation.settings.config.serviceTier ?? "";
  const serviceTier = storedTier === "priority" && serviceTiers.some((tier) => tier.id === "fast") ? "fast" : storedTier;
  const permissionLabel = controls.showPermissionControls && permissionMode ? permissionShortLabel(providerId, permissionMode) : null;
  const hasRunOptions = controls.mode !== null && (permissionLabel || selected?.supportsFastMode || serviceTiers.length > 0 || controls.supportsGoalMode || controls.supportsPlanMode);

  return {
    ...conversation,
    ...controls,
    ready: conversation.ready && controls.mode !== null,
    models: list,
    selected,
    label: selected ? modelPrettyName(selected, providerId) : null,
    effortLevel,
    /** Null when the selected model has no effort levels — nothing to show. */
    effortLabel: supportedLevels.length > 0 || effortLevel ? formatEffortLevel(effortLevel) : null,
    supportedLevels,
    permissionMode,
    permissionLabel,
    permissionOptions: controls.showPermissionControls ? permissionModesFor(providerId) : [],
    runOptionsLabel: hasRunOptions ? permissionLabel ?? "Options" : null,
    runOptionsAccessibilityLabel: permissionLabel ? `Permissions: ${permissionLabel}` : "Run options",
    fastMode: settings.fastMode,
    supportsFastMode: selected?.supportsFastMode ?? false,
    serviceTier,
    serviceTiers,
    goalMode: settings.goalMode,
    planMode: settings.planMode,
  };
}
