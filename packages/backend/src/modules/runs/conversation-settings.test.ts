import { describe, expect, it } from "vitest";
import { validateConversationSettings, resolveConversationSettings } from "./conversation-settings";

describe("conversation effort settings", () => {
  it("accepts OpenCode's agent setting", () => {
    expect(validateConversationSettings("opencode", {
      model: "openai/gpt-5",
      config: { agent: "build" },
    })).toEqual({ model: "openai/gpt-5", config: { agent: "build" } });
  });

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

  it("preserves an OpenCode model variant as its effort", () => {
    const settings = { model: "openai/gpt-5", config: { effortLevel: "high" } };
    expect(validateConversationSettings("opencode", settings)).toEqual(settings);
  });

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

describe("Codex permission profile preferences", () => {
  it("prevents a newly configured global profile from changing an older saved conversation", () => {
    const settings = resolveConversationSettings("codex", { permissionProfile: "writable-default" }, {
      conversationSettings: { model: "model", config: { sandboxMode: "read-only" } },
    }, "model");
    expect(settings.config).toMatchObject({ sandboxMode: "read-only", permissionProfile: "" });
  });
  it("keeps legacy snapshots without conversationSettings independent of a new global profile", () => {
    expect(resolveConversationSettings("codex", { permissionProfile: "writable-default" }, { sandboxMode: "read-only" }, "model").config)
      .toMatchObject({ sandboxMode: "read-only", permissionProfile: "" });
    expect(resolveConversationSettings("codex", { permissionProfile: "writable-default" }, null, "model").config.permissionProfile).toBe("");
    expect(resolveConversationSettings("codex", { permissionProfile: "new-chat-default" }, { sandboxMode: "workspace-write" }, "selected-model", undefined, { inheritProviderPermissions: true }).config.permissionProfile).toBe("new-chat-default");
  });
  it("retains an explicitly selected native profile and rejects cross-provider or invalid profile fields", () => {
    const settings = { model: "model", config: { permissionProfile: "project-edit" } };
    expect(validateConversationSettings("codex", settings)).toEqual(settings);
    expect(() => validateConversationSettings("claude_code", settings)).toThrow("Invalid Codex permission profile");
    expect(() => validateConversationSettings("codex", { model: "model", config: { permissionProfile: "bad\nprofile" } })).toThrow();
  });
});
