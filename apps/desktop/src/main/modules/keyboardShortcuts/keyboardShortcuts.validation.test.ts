import { describe, expect, it } from "vitest";
import {
  applyKeyboardShortcutUpdate,
  requireKeyboardShortcutUpdate,
} from "./keyboardShortcuts.validation";

describe("keyboard shortcut updates", () => {
  it("normalizes a valid custom binding", () => {
    expect(
      requireKeyboardShortcutUpdate(
        { id: "app.openSettings", binding: "cmd+shift+comma" },
        {},
      ),
    ).toEqual({
      id: "app.openSettings",
      binding: "Command+Shift+Comma",
    });
  });

  it("rejects reserved and conflicting bindings", () => {
    expect(() =>
      requireKeyboardShortcutUpdate(
        { id: "app.openSettings", binding: "Command+Q" },
        {},
      ),
    ).toThrow("reserved by macOS");

    expect(() =>
      requireKeyboardShortcutUpdate(
        { id: "browser.print", binding: "Command+Shift+P" },
        {},
      ),
    ).toThrow("already used by Focus composer");
  });

  it("stores unassigned commands and drops default-valued overrides", () => {
    expect(
      applyKeyboardShortcutUpdate({}, {
        id: "app.openSettings",
        binding: null,
      }),
    ).toEqual({ "app.openSettings": null });

    expect(
      applyKeyboardShortcutUpdate(
        { "app.openSettings": "Command+Shift+Comma" },
        { id: "app.openSettings", binding: "Command+Shift+S" },
      ),
    ).toEqual({});
  });
});
