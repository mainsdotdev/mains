import {
  findKeyboardShortcutConflict,
  isKeyboardShortcutId,
  isReservedKeyboardShortcut,
  normalizeKeyboardShortcut,
  resolveKeyboardShortcut,
  type KeyboardShortcutId,
  type KeyboardShortcutOverrides,
} from "../../../shared/keyboard-shortcuts";

export interface KeyboardShortcutUpdate {
  id: KeyboardShortcutId;
  binding: string | null;
}

export function requireKeyboardShortcutUpdate(
  input: unknown,
  overrides: KeyboardShortcutOverrides,
): KeyboardShortcutUpdate {
  if (!input || typeof input !== "object") {
    throw new Error("Keyboard shortcut update must be an object");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.id !== "string" || !isKeyboardShortcutId(value.id)) {
    throw new Error("Unknown keyboard shortcut command");
  }
  if (value.binding === null) return { id: value.id, binding: null };

  const binding = normalizeKeyboardShortcut(value.binding);
  if (!binding) {
    throw new Error("Shortcut must include a modifier key");
  }
  if (isReservedKeyboardShortcut(binding)) {
    throw new Error("This shortcut is reserved by macOS");
  }
  const conflict = findKeyboardShortcutConflict(value.id, binding, overrides);
  if (conflict) {
    throw new Error(`Shortcut is already used by ${conflict.title}`);
  }
  return { id: value.id, binding };
}

export function applyKeyboardShortcutUpdate(
  overrides: KeyboardShortcutOverrides,
  update: KeyboardShortcutUpdate,
): KeyboardShortcutOverrides {
  const next = { ...overrides };
  if (update.binding === resolveKeyboardShortcut(update.id, {})) {
    delete next[update.id];
  } else {
    next[update.id] = update.binding;
  }
  return next;
}
