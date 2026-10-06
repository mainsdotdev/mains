import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import {
  conversationSettingsFrom, snapshotRunSettingConfig,
  type ConversationSettings, type RunSettingConfig, type SettingsChangeSource,
} from "@mains/contracts/run-settings";
import { useGetProviderByIdQuery } from "@/lib/redux/api/providersApi";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { beginRunSettingsIntent, rememberRunSettings, setConversationSettings } from "@/lib/redux/slices/workspaceSlice";
import { store } from "@/lib/redux";
import { getTransport } from "@/lib/transport";
import { toast } from "@/components/ui";
import type { Run } from "../types";
import { persistConversationSettings } from "../lib/conversation-settings-writer";
import { providerSettingsKey } from "../../../../shared/ui-state-keys";

export function useConversationSettings({ backendId = null, providerId, ownerKey, runId, run, latestModel, loadingRun, mirrorOnly = false }: {
  backendId?: string | null;
  providerId: string; ownerKey: string; runId: string | null; run?: Run;
  latestModel?: string | null; loadingRun: boolean; mirrorOnly?: boolean;
}) {
  const dispatch = useAppDispatch();
  const { data: provider } = useGetProviderByIdQuery(providerId, { skip: !providerId });
  const owned = useAppSelector((state) => state.workspace.conversationSettingsByKey?.[ownerKey]);
  const remembered = useAppSelector((state) => state.workspace.lastRunSettingsByProvider?.[providerSettingsKey(backendId, providerId)]);
  const initializedOwner = useRef<{ key: string; backendId: string | null; providerId: string; draft: boolean } | null>(null);
  const legacyModel = useAppSelector((state) => state.workspace.selectedModelByProvider[providerId]);
  const saved = useMemo(() => conversationSettingsFrom(run?.configSnapshot), [run?.configSnapshot]);
  const initial = useMemo<ConversationSettings>(() => {
    if (saved) return saved;
    if (!runId && remembered) return remembered;
    return {
      model: runId ? latestModel || run?.model || "" : provider?.defaultModel || legacyModel || "",
      config: {
        ...snapshotRunSettingConfig(providerId, {
          thinkingMode: provider?.config?.thinking ?? true, ...provider?.config, ...run?.configSnapshot,
        }),
        ...(!runId ? { goalMode: false, planMode: false } : {}),
      },
    };
  }, [saved, remembered, run?.configSnapshot, run?.model, latestModel, runId, legacyModel, provider, providerId]);
  const settings = owned ?? initial;
  const ready = !!owned || (!mirrorOnly && (!!saved ||
    (!!provider && (!runId || (!!run && !loadingRun)))));

  useLayoutEffect(() => {
    if (!ready || mirrorOnly) return;
    const previousOwner = initializedOwner.current;
    const enteringDraft = !runId && previousOwner?.key !== ownerKey;
    initializedOwner.current = { key: ownerKey, backendId, providerId, draft: !runId };
    // Moving a draft to another workspace/collection keeps the deliberate
    // choices made in that draft. Opening New Run starts from the last run.
    const movingDraft = previousOwner?.draft && previousOwner.backendId === backendId && previousOwner.providerId === providerId;
    if (owned && (!enteringDraft || movingDraft)) return;
    const next = !runId && owned && !remembered
      ? { ...owned, config: { ...owned.config, goalMode: false, planMode: false } }
      : initial;
    dispatch(setConversationSettings({ key: ownerKey, settings: next }));
    if (runId && !saved) {
      void persistConversationSettings(getTransport(), runId, initial).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
      });
    }
  }, [owned, ready, mirrorOnly, dispatch, ownerKey, initial, runId, saved, remembered, backendId, providerId]);

  const beginSettingsIntent = useCallback(() => {
    if (mirrorOnly) return 0;
    dispatch(beginRunSettingsIntent({ backendId, providerId, ownerKey }));
    return store.getState().workspace.runSettingsIntentByProvider[providerSettingsKey(backendId, providerId)].revision;
  }, [mirrorOnly, dispatch, backendId, providerId, ownerKey]);

  const rememberSettings = useCallback((submitted: ConversationSettings, revision: number) => {
    if (mirrorOnly) return;
    const state = store.getState().workspace;
    const intent = state.runSettingsIntentByProvider[providerSettingsKey(backendId, providerId)];
    if (!intent) return;
    // Edits in this same composer during preparation belong to the accepted
    // run. Another composer's successful choice keeps its newer revision.
    const acceptedRevision = intent.ownerKey === ownerKey ? intent.revision : revision;
    const latest = state.conversationSettingsByKey?.[ownerKey] ?? submitted;
    dispatch(rememberRunSettings({ backendId, providerId, settings: latest, revision: acceptedRevision }));
  }, [mirrorOnly, ownerKey, dispatch, backendId, providerId]);

  const changeSettings = useCallback(async (next: ConversationSettings, source: SettingsChangeSource = "user") => {
    if (!ready) return false;
    dispatch(setConversationSettings({ key: ownerKey, settings: next }));
    const revision = source === "user" ? beginSettingsIntent() : undefined;
    if (!runId || mirrorOnly) return true;
    // Local defaults follow the selection immediately, even if the backend
    // write is still in flight when the user opens New Run.
    if (revision !== undefined) rememberSettings(next, revision);
    try {
      await persistConversationSettings(getTransport(), runId, next);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
      return false;
    }
  }, [ready, dispatch, ownerKey, runId, mirrorOnly, beginSettingsIntent, rememberSettings]);
  const saveDraftSettingsToRun = useCallback(async (id: string, submitted: ConversationSettings) => {
    const latest = store.getState().workspace.conversationSettingsByKey?.[ownerKey];
    if (!latest || latest === submitted || mirrorOnly) return;
    try {
      await persistConversationSettings(getTransport(), id, latest);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
    }
  }, [ownerKey, mirrorOnly]);
  const changeConfig = useCallback((patch: RunSettingConfig, source?: SettingsChangeSource) => {
    const current = store.getState().workspace.conversationSettingsByKey?.[ownerKey] ?? settings;
    return changeSettings({ ...current, config: { ...current.config, ...patch } }, source);
  }, [ownerKey, settings, changeSettings]);
  const changeModel = useCallback((model: string, source?: SettingsChangeSource) => {
    const current = store.getState().workspace.conversationSettingsByKey?.[ownerKey] ?? settings;
    return changeSettings({ ...current, model }, source);
  }, [ownerKey, settings, changeSettings]);
  return { settings, ready, changeSettings, changeConfig, changeModel, saveDraftSettingsToRun, beginSettingsIntent, rememberSettings };
}
