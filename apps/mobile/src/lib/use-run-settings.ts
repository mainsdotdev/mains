import { and, desc, eq } from "drizzle-orm";
import { useCoalescedLiveQuery } from "@/db/use-coalesced-live-query";
import { useCallback, useState, useSyncExternalStore } from "react";

import { db } from "@/db/client";
import { composerSettings, modelChoices, providers, runs, runTurns } from "@/db/schema";
import { changeComposerSettings, composerSettingsKey, settingsWriter } from "@/backend/composer-settings";
import { initialConversationSettings, parseConfig, parseSettings, type ComposerSettingsPatch } from "./conversation-settings";

/** Both the sheet and its composer observe durable settings plus one shared pending write. */
export function useRunSettings(backendId: string, providerId: string, runId: string | null | undefined, defaultModel: string) {
  const key = composerSettingsKey(backendId, providerId, runId);
  const providerQuery = useCoalescedLiveQuery(db.select().from(providers).where(and(eq(providers.backendId, backendId), eq(providers.id, providerId))), providers, [backendId, providerId]);
  const runQuery = useCoalescedLiveQuery(db.select().from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId ?? ""))), runs, [backendId, runId]);
  const turnQuery = useCoalescedLiveQuery(db.select({ model: runTurns.model }).from(runTurns).where(and(eq(runTurns.backendId, backendId), eq(runTurns.runId, runId ?? ""))).orderBy(desc(runTurns.turnIndex)).limit(1), runTurns, [backendId, runId]);
  const choicesQuery = useCoalescedLiveQuery(db.select().from(composerSettings).where(and(eq(composerSettings.backendId, backendId), eq(composerSettings.providerId, providerId))), composerSettings, [backendId, providerId]);
  const legacyQuery = useCoalescedLiveQuery(db.select().from(modelChoices).where(and(eq(modelChoices.backendId, backendId), eq(modelChoices.providerId, providerId))), modelChoices, [backendId, providerId]);
  const getPending = useCallback(() => settingsWriter.getPending(key), [key]);
  const pending = useSyncExternalStore(settingsWriter.subscribe, getPending, getPending);
  const settings = pending ?? initialConversationSettings({
    providerId,
    providerConfig: parseConfig(providerQuery.data[0]?.runSettingsJson),
    run: runId ? runQuery.data[0] ?? { model: null, configSnapshotJson: null } : null,
    latestModel: turnQuery.data[0]?.model,
    draft: parseSettings(choicesQuery.data.find((row) => row.kind === "draft")?.settingsJson),
    remembered: parseSettings(choicesQuery.data.find((row) => row.kind === "defaults")?.settingsJson),
    defaultModel: legacyQuery.data[0]?.modelId ?? defaultModel,
  });
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const ready = !!backendId && !!providerQuery.data[0] && (!runId || !!runQuery.data[0]);

  const apply = async (patch: ComposerSettingsPatch): Promise<void> => {
    if (!ready) return;
    setError(null);
    try {
      await changeComposerSettings(backendId, providerId, runId, patch);
    } catch (caught) {
      setError({ key, message: caught instanceof Error ? caught.message : "Could not save conversation settings" });
    }
  };

  return {
    settings,
    ready,
    saving: pending !== null,
    hint: error?.key === key ? error.message : null,
    apply,
  };
}
