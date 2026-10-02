import { expect, it } from "vitest";
import { migrateMcpAppPinSettings } from "./app-settings-persistence";

it("preserves old pin order for live reconciliation and removes the retired persisted field", () => {
  const saved = { _persist: { version: 3, rehydrated: true }, sidebarCollapsed: true,
    pinnedMcpAppIdsByProvider: { codex: ["old-a", "old-b"], claude_code: ["old-c"] } };
  expect(migrateMcpAppPinSettings(saved)).toEqual({
    _persist: saved._persist, sidebarCollapsed: true,
    pinnedMcpAppKeysByProvider: saved.pinnedMcpAppIdsByProvider,
  });
  expect(saved.pinnedMcpAppIdsByProvider.codex).toEqual(["old-a", "old-b"]);
});

it("keeps new pin preferences when migration is repeated and leaves fresh installs empty", () => {
  const saved = { _persist: { version: 4, rehydrated: true }, pinnedMcpAppKeysByProvider: { codex: ["new-key"] } };
  expect(migrateMcpAppPinSettings(saved)).toEqual(saved);
  expect(migrateMcpAppPinSettings({ _persist: saved._persist })).toEqual({
    _persist: saved._persist, pinnedMcpAppKeysByProvider: {},
  });
  expect(migrateMcpAppPinSettings(undefined)).toBeUndefined();
});
