import { and, asc, eq } from "drizzle-orm";
import { useLiveQuery } from "drizzle-orm/expo-sqlite";

import { db } from "@/db/client";
import { modelChoices, models, providers } from "@/db/schema";

import {
  dedupeModelsByPrettyName,
  formatEffortLevel,
  modelPrettyName,
  parseEffortLevels,
  permissionModesFor,
  permissionShortLabel,
  supportsGoalMode,
  supportsPlanToggle,
} from "./models";

/**
 * What the composer's model pill and the model sheet both need for one
 * provider: the pickable models, the one in effect (the phone's choice, else
 * the provider's default), and the provider's effort as the Mac holds it.
 */
export function useModelSelection(backendId: string, providerId: string) {
  const modelQuery = useLiveQuery(
    db
      .select()
      .from(models)
      .where(and(eq(models.backendId, backendId), eq(models.providerId, providerId)))
      .orderBy(asc(models.sortOrder)),
    [backendId, providerId],
  );
  const choiceQuery = useLiveQuery(
    db
      .select()
      .from(modelChoices)
      .where(and(eq(modelChoices.backendId, backendId), eq(modelChoices.providerId, providerId)))
      .limit(1),
    [backendId, providerId],
  );
  const providerQuery = useLiveQuery(
    db
      .select()
      .from(providers)
      .where(and(eq(providers.backendId, backendId), eq(providers.id, providerId)))
      .limit(1),
    [backendId, providerId],
  );

  const list = dedupeModelsByPrettyName(modelQuery.data, providerId);
  const choice = choiceQuery.data[0]?.modelId;
  const selected =
    list.find((m) => m.id === choice) ?? list.find((m) => m.isDefault) ?? list[0] ?? null;
  const provider = providerQuery.data[0];
  const effortLevel = provider?.effortLevel ?? "";
  const supportedLevels = parseEffortLevels(selected?.effortLevels);
  const permissionMode = provider?.permissionMode ?? "";

  return {
    models: list,
    selected,
    label: selected ? modelPrettyName(selected, providerId) : null,
    effortLevel,
    /** Null when the selected model has no effort levels — nothing to show. */
    effortLabel: supportedLevels.length > 0 || effortLevel ? formatEffortLevel(effortLevel) : null,
    supportedLevels,
    permissionMode,
    permissionLabel: permissionMode ? permissionShortLabel(providerId, permissionMode) : null,
    permissionOptions: permissionModesFor(providerId),
    fastMode: provider?.fastMode ?? false,
    supportsFastMode: selected?.supportsFastMode ?? false,
    goalMode: provider?.goalMode ?? false,
    supportsGoalMode: supportsGoalMode(providerId),
    planMode: provider?.planMode ?? false,
    supportsPlanMode: supportsPlanToggle(providerId),
  };
}
