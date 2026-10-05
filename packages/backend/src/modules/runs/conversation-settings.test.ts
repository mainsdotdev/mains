import { describe, expect, it } from "vitest";
import { validateConversationSettings } from "./conversation-settings";

describe("conversation effort settings", () => {
  it.each(["ultra", "future-effort", "FutureEffort", ""])(
    "preserves the app-server effort identifier %j for Codex",
    (level) => {
      const settings = {
        model: "server-model",
        config: { modelReasoningEffort: level, thinkingMode: !!level },
      };
      expect(validateConversationSettings("codex", settings)).toEqual(settings);
    },
  );

  it.each(["claude_code", "copilot_cli", "cursor"])(
    "keeps the known effort validation for %s",
    (providerId) => {
      expect(() => validateConversationSettings(providerId, {
        model: "model",
        config: { modelReasoningEffort: "ultra" },
      })).toThrow('Unknown effort level "ultra"');
    },
  );

  it.each([123, true, null, [], {}].map((level) => ({ level })))(
    "rejects a non-string Codex effort $level",
    ({ level }) => {
      expect(() => validateConversationSettings("codex", {
        model: "server-model",
        config: { modelReasoningEffort: level as never },
      })).toThrow('Invalid conversation setting "modelReasoningEffort"');
    },
  );
});
