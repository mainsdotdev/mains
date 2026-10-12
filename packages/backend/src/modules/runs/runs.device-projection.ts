import { conversationSettingsFrom, pickRunSettingConfig } from "@mains/contracts/run-settings";
import type { RunResponse } from "./runs.dto";

/** The phone's list/composer needs metadata, not full execution prompt/policy bodies. */
export function runForPairedDevice(run: RunResponse): RunResponse {
  const settings = conversationSettingsFrom(run.configSnapshot);
  return { ...run, goal: null, systemPrompt: null, toolPolicySnapshot: null,
    configSnapshot: { ...pickRunSettingConfig(run.configSnapshot ?? {}), ...(settings ? { conversationSettings: settings } : {}) } };
}
