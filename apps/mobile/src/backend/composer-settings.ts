import { and, asc, desc, eq } from "drizzle-orm";
import type { ConversationSettings } from "@mains/contracts/run-settings";

import { db } from "@/db/client";
import { composerSettings, models, providers, runs, runTurns } from "@/db/schema";
import { initialConversationSettings, parseConfig, parseSettings, patchConversationSettings, type ComposerSettingsPatch } from "@/lib/conversation-settings";
import { createConversationSettingsWriter, createSettingsIntents } from "@/lib/conversation-settings-writer";
import { backendSession } from "./backend-session";
import { getModelChoice, setComposerSettings } from "./sync";

export const settingsWriter = createConversationSettingsWriter();
const intents = createSettingsIntents();
const providerKey = (backendId: string, providerId: string) => JSON.stringify([backendId, providerId]);
export const composerSettingsKey = (backendId: string, providerId: string, runId?: string | null) => JSON.stringify([backendId, providerId, runId || "draft"]);

/** Reading a chat never changes new-chat defaults. */
export function getComposerSettings(backendId: string, providerId: string, runId?: string | null): ConversationSettings {
  const pending = settingsWriter.getPending(composerSettingsKey(backendId, providerId, runId));
  if (pending) return pending;
  const provider = db.select().from(providers).where(and(eq(providers.backendId, backendId), eq(providers.id, providerId))).get();
  const run = runId ? db.select().from(runs).where(and(eq(runs.backendId, backendId), eq(runs.id, runId))).get() : null;
  const latestTurn = runId ? db.select().from(runTurns).where(and(eq(runTurns.backendId, backendId), eq(runTurns.runId, runId))).orderBy(desc(runTurns.turnIndex)).get() : null;
  const choices = db.select().from(composerSettings).where(and(eq(composerSettings.backendId, backendId), eq(composerSettings.providerId, providerId))).all();
  const defaultModel = db.select().from(models).where(and(eq(models.backendId, backendId), eq(models.providerId, providerId))).orderBy(desc(models.isDefault), asc(models.sortOrder)).get()?.id ?? "";
  return initialConversationSettings({
    providerId,
    providerConfig: parseConfig(provider?.runSettingsJson),
    // A run still loading must not inherit the phone's new-chat choice.
    run: runId ? run ?? { model: null, configSnapshotJson: null } : null,
    latestModel: latestTurn?.model,
    draft: parseSettings(choices.find((row) => row.kind === "draft")?.settingsJson),
    remembered: parseSettings(choices.find((row) => row.kind === "defaults")?.settingsJson),
    defaultModel: getModelChoice(backendId, providerId) ?? defaultModel,
  });
}

export function beginSettingsIntent(backendId: string, providerId: string): number {
  return intents.begin(providerKey(backendId, providerId));
}

export function rememberAcceptedSettings(backendId: string, providerId: string, settings: ConversationSettings, revision: number): void {
  if (intents.accept(providerKey(backendId, providerId), revision)) {
    setComposerSettings(backendId, providerId, "defaults", settings);
  }
}

export async function changeComposerSettings(backendId: string, providerId: string, runId: string | null | undefined, patch: ComposerSettingsPatch): Promise<void> {
  const settings = patchConversationSettings(providerId, getComposerSettings(backendId, providerId, runId), patch);
  const revision = beginSettingsIntent(backendId, providerId);
  if (!runId) {
    setComposerSettings(backendId, providerId, "draft", settings);
    return;
  }
  await settingsWriter.write(composerSettingsKey(backendId, providerId, runId), settings, async (next) => {
    const result = await backendSession.updateConversationSettings(backendId, runId, next);
    if (!result.success) throw new Error(result.error);
    rememberAcceptedSettings(backendId, providerId, result.data, revision);
  });
}

export function waitForComposerSettings(backendId: string, providerId: string, runId: string): Promise<void> {
  return settingsWriter.wait(composerSettingsKey(backendId, providerId, runId));
}
