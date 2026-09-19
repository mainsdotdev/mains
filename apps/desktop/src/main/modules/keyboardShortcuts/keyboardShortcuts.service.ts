import { appSettingsService } from "../appSettings";
import {
  bindingsForKeyboardShortcuts,
  parseKeyboardShortcutOverrides,
  resolveKeyboardShortcut,
  type KeyboardShortcutId,
  type KeyboardShortcutOverrides,
} from "../../../shared/keyboard-shortcuts";
import {
  applyKeyboardShortcutUpdate,
  requireKeyboardShortcutUpdate,
} from "./keyboardShortcuts.validation";

export interface KeyboardShortcutsStatus {
  overrides: KeyboardShortcutOverrides;
  bindings: Record<KeyboardShortcutId, string | null>;
}

let currentOverrides: KeyboardShortcutOverrides = {};

function status(): KeyboardShortcutsStatus {
  return {
    overrides: { ...currentOverrides },
    bindings: bindingsForKeyboardShortcuts(currentOverrides),
  };
}

export const keyboardShortcutsService = {
  async start(): Promise<KeyboardShortcutsStatus> {
    const settings = await appSettingsService.getSettings();
    currentOverrides = parseKeyboardShortcutOverrides(
      settings.keyboardShortcutOverrides,
    );
    return status();
  },

  getStatus(): KeyboardShortcutsStatus {
    return status();
  },

  getBinding(id: KeyboardShortcutId): string | null {
    return resolveKeyboardShortcut(id, currentOverrides);
  },

  async update(input: unknown): Promise<KeyboardShortcutsStatus> {
    const update = requireKeyboardShortcutUpdate(input, currentOverrides);
    const next = applyKeyboardShortcutUpdate(currentOverrides, update);
    await appSettingsService.updateKeyboardShortcutOverrides(
      JSON.stringify(next),
    );
    currentOverrides = next;
    return status();
  },

  async resetAll(): Promise<KeyboardShortcutsStatus> {
    await appSettingsService.updateKeyboardShortcutOverrides("{}");
    currentOverrides = {};
    return status();
  },
};
