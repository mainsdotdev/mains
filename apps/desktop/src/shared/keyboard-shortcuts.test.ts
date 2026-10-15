import { describe, expect, it } from "vitest";
import {
  findKeyboardShortcutConflict,
  formatKeyboardShortcut,
  keyboardShortcutFromInput,
  normalizeKeyboardShortcut,
  parseKeyboardShortcutOverrides,
  resolveKeyboardShortcut,
  matchesKeyboardShortcut,
  isReservedKeyboardShortcut,
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
    expect(formatKeyboardShortcut("Command+Option+BracketLeft", "darwin")).toEqual([
      "⌘",
      "⌥",
      "[",
    ]);
  });

  it("falls back to defaults and preserves an explicit unassigned override", () => {
    expect(resolveKeyboardShortcut("app.openSettings", {}, "darwin")).toBe(
      "Command+Shift+S",
    );
    expect(resolveKeyboardShortcut("app.closeSettings", {}, "darwin")).toBe(
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
      findKeyboardShortcutConflict("editor.addSelection", "Command+L", {}, "darwin"),
    ).toBeNull();
  });

  it("detects conflicts with an app-wide command", () => {
    expect(
      findKeyboardShortcutConflict(
        "browser.print",
        "Command+Shift+P",
        {},
        "darwin",
      )?.id,
    ).toBe("app.focusComposer");
  });

  it("uses Control and Alt defaults on Windows and keeps custom bindings intact", () => {
    const binding = resolveKeyboardShortcut("app.toggleTerminal", {}, "win32");
    expect(binding).toBe("Control+J");
    expect(matchesKeyboardShortcut({ code: "KeyJ", ctrlKey: true }, binding)).toBe(true);
    expect(matchesKeyboardShortcut({ code: "KeyJ", metaKey: true }, binding)).toBe(false);
    expect(formatKeyboardShortcut(resolveKeyboardShortcut("app.commandMenu", {}, "win32"), "win32"))
      .toEqual(["Ctrl", "Alt", "K"]);
    expect(resolveKeyboardShortcut("app.toggleTerminal", { "app.toggleTerminal": "Control+Shift+J" }, "win32"))
      .toBe("Control+Shift+J");
  });

  it("reserves Windows system chords and finds conflicts against Windows defaults", () => {
    expect(isReservedKeyboardShortcut("Option+F4", "win32")).toBe(true);
    expect(isReservedKeyboardShortcut("Control+C", "win32")).toBe(true);
    expect(findKeyboardShortcutConflict("browser.print", "Control+J", {}, "win32")?.id)
      .toBe("app.toggleTerminal");
  });
});
