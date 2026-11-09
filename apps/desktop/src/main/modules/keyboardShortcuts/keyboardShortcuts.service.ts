import { appSettingsService } from "@mains/backend/modules/appSettings";
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
import { createShortcutWriteQueue } from "../../../shared/capture-shortcut-lifecycle";

export interface KeyboardShortcutsStatus {
  overrides: KeyboardShortcutOverrides;
  bindings: Record<KeyboardShortcutId, string | null>;
}

let currentOverrides: KeyboardShortcutOverrides = {};
const writes = createShortcutWriteQueue();

function status(): KeyboardShortcutsStatus {
  return {
    overrides: { ...currentOverrides },
    bindings: bindingsForKeyboardShortcuts(currentOverrides),
  };
}

export const keyboardShortcutsService = {
  async start(): Promise<KeyboardShortcutsStatus> {
    await writes.restore(() => appSettingsService.getSettings(), (settings) => {
      currentOverrides = parseKeyboardShortcutOverrides(settings.keyboardShortcutOverrides);
    });
    return status();
  },

  stop(): Promise<void> { return writes.stop(); },

  getStatus(): KeyboardShortcutsStatus {
    return status();
  },

  getBinding(id: KeyboardShortcutId): string | null {
    return resolveKeyboardShortcut(id, currentOverrides);
  },

  async update(input: unknown): Promise<KeyboardShortcutsStatus> {
    return writes.run(async () => {
      const update = requireKeyboardShortcutUpdate(input, currentOverrides);
      const next = applyKeyboardShortcutUpdate(currentOverrides, update);
      await appSettingsService.updateKeyboardShortcutOverrides(
        JSON.stringify(next),
      );
      currentOverrides = next;
      return status();
    });
  },

  async resetAll(): Promise<KeyboardShortcutsStatus> {
    return writes.run(async () => {
      await appSettingsService.updateKeyboardShortcutOverrides("{}");
      currentOverrides = {};
      return status();
    });
  },
};
