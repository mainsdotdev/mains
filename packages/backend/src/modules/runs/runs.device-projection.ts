import { conversationSettingsFrom, pickRunSettingConfig } from "@mains/contracts/run-settings";
import { formatRunLabel, type RunResponse } from "./runs.dto";

/** The phone's list/composer needs metadata, not full execution prompt/policy bodies. */
export function runForPairedDevice(run: RunResponse): RunResponse {
  const settings = conversationSettingsFrom(run.configSnapshot);
  // Resolve the same label as desktop before removing the goal. Bound the
  // display-only title by Unicode scalars without copying a large prompt.
  let title = "", length = 0;
  for (const scalar of formatRunLabel(run) ?? "") {
    if (length++ === 240) break;
    title += scalar;
  }
  return { ...run, title: title || null, goal: null, systemPrompt: null, toolPolicySnapshot: null,
    configSnapshot: { ...pickRunSettingConfig(run.configSnapshot ?? {}), ...(settings ? { conversationSettings: settings } : {}) } };
}
