import { useCallback, useLayoutEffect, useMemo } from "react";
import {
  conversationSettingsFrom, snapshotRunSettingConfig,
  type ConversationSettings, type RunSettingConfig,
} from "@mains/contracts/run-settings";
import { useGetProviderByIdQuery } from "@/lib/redux/api/providersApi";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { setConversationSettings } from "@/lib/redux/slices/workspaceSlice";
import { store } from "@/lib/redux";
import { getTransport } from "@/lib/transport";
import { toast } from "@/components/ui";
import type { Run } from "../types";
import { persistConversationSettings } from "../lib/conversation-settings-writer";

export function useConversationSettings({ providerId, ownerKey, runId, run, latestModel, loadingRun, mirrorOnly = false }: {
  providerId: string; ownerKey: string; runId: string | null; run?: Run;
  latestModel?: string | null; loadingRun: boolean; mirrorOnly?: boolean;
}) {
  const dispatch = useAppDispatch();
  const { data: provider } = useGetProviderByIdQuery(providerId, { skip: !providerId });
  const owned = useAppSelector((state) => state.workspace.conversationSettingsByKey?.[ownerKey]);
  const legacyModel = useAppSelector((state) => state.workspace.selectedModelByProvider[providerId]);
  const saved = useMemo(() => conversationSettingsFrom(run?.configSnapshot), [run?.configSnapshot]);
  const initial = useMemo<ConversationSettings>(() => saved ?? {
    model: runId ? latestModel || run?.model || "" : String(provider?.config?.defaultModel ?? "") || legacyModel || "",
    config: snapshotRunSettingConfig(providerId, {
      thinkingMode: provider?.config?.thinking ?? true, ...provider?.config, ...run?.configSnapshot,
    }),
  }, [saved, run?.configSnapshot, run?.model, latestModel, runId, legacyModel, provider, providerId]);
  const settings = owned ?? initial;
  const ready = !!owned || (!mirrorOnly && (!!saved ||
    (!!provider && (!runId || (!!run && !loadingRun)))));

  useLayoutEffect(() => {
    if (owned || !ready || mirrorOnly) return;
    dispatch(setConversationSettings({ key: ownerKey, settings: initial }));
    if (runId && !saved) {
      void persistConversationSettings(getTransport(), runId, initial).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
      });
    }
  }, [owned, ready, mirrorOnly, dispatch, ownerKey, initial, runId, saved]);

  const changeSettings = useCallback(async (next: ConversationSettings) => {
    if (!ready) return false;
    dispatch(setConversationSettings({ key: ownerKey, settings: next }));
    if (!runId || mirrorOnly) return true;
    try {
      await persistConversationSettings(getTransport(), runId, next);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
      return false;
    }
  }, [ready, dispatch, ownerKey, runId, mirrorOnly]);
  const saveDraftSettingsToRun = useCallback(async (id: string, submitted: ConversationSettings) => {
    const latest = store.getState().workspace.conversationSettingsByKey?.[ownerKey];
    if (!latest || latest === submitted || mirrorOnly) return;
    try {
      await persistConversationSettings(getTransport(), id, latest);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save conversation settings");
    }
  }, [ownerKey, mirrorOnly]);
  const changeConfig = useCallback((patch: RunSettingConfig) => {
    const current = store.getState().workspace.conversationSettingsByKey?.[ownerKey] ?? settings;
    return changeSettings({ ...current, config: { ...current.config, ...patch } });
  }, [ownerKey, settings, changeSettings]);
  const changeModel = useCallback((model: string) => {
    const current = store.getState().workspace.conversationSettingsByKey?.[ownerKey] ?? settings;
    return changeSettings({ ...current, model });
  }, [ownerKey, settings, changeSettings]);
  return { settings, ready, changeSettings, changeConfig, changeModel, saveDraftSettingsToRun };
}
