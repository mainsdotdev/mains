import { describe, expect, it } from "vitest";
import {
  findKeyboardShortcutConflict,
  formatKeyboardShortcut,
  keyboardShortcutFromInput,
  normalizeKeyboardShortcut,
  parseKeyboardShortcutOverrides,
  resolveKeyboardShortcut,
} from "./keyboard-shortcuts";

describe("keyboard shortcuts", () => {
  it("normalizes aliases into one stable representation", () => {
    expect(normalizeKeyboardShortcut("cmd+alt+k")).toBe("Command+Option+K");
    expect(normalizeKeyboardShortcut("Command+Shift+Digit2")).toBe(
      "Command+Shift+2",
    );
    expect(normalizeKeyboardShortcut("Shift+K")).toBeNull();
    expect(normalizeKeyboardShortcut("F8")).toBe("F8");
  });

  it("captures a DOM-style keyboard input", () => {
    expect(
      keyboardShortcutFromInput({
        code: "KeyP",
        key: "p",
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe("Command+Shift+P");
  });

  it("formats macOS keycaps", () => {
    expect(formatKeyboardShortcut("Command+Option+BracketLeft")).toEqual([
      "⌘",
      "⌥",
      "[",
    ]);
  });

  it("falls back to defaults and preserves an explicit unassigned override", () => {
    expect(resolveKeyboardShortcut("app.openSettings", {})).toBe(
      "Command+Shift+S",
    );
    expect(resolveKeyboardShortcut("app.closeSettings", {})).toBe(
      "Command+Shift+W",
    );
    expect(resolveKeyboardShortcut("app.openSettings", { "app.openSettings": null })).toBeNull();
  });

  it("sanitizes persisted JSON and drops unknown commands", () => {
    expect(
      parseKeyboardShortcutOverrides(
        JSON.stringify({
          "app.openSettings": "cmd+shift+comma",
          "unknown.command": "Command+Z",
        }),
      ),
    ).toEqual({ "app.openSettings": "Command+Shift+Comma" });
  });

  it("allows editor and browser contexts to reuse a chord", () => {
    expect(
      findKeyboardShortcutConflict("editor.addSelection", "Command+L", {}),
    ).toBeNull();
  });

  it("detects conflicts with an app-wide command", () => {
    expect(
      findKeyboardShortcutConflict(
        "browser.print",
        "Command+Shift+P",
        {},
      )?.id,
    ).toBe("app.focusComposer");
  });
});
