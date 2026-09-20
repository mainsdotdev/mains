export type KeyboardShortcutScope = "app" | "browser" | "editor" | "settings";

export type KeyboardShortcutCategory =
  | "General"
  | "Navigation"
  | "Projects"
  | "Browser"
  | "Editor";

export const KEYBOARD_SHORTCUTS = [
  {
    id: "app.commandMenu",
    title: "Search Mains",
    description: "Open commands, settings, projects, and recent work",
    category: "General",
    scope: "app",
    defaultBinding: "Command+Option+K",
  },
  {
    id: "app.newItem",
    title: "New item",
    description: "Open the new item menu or start a chat in the current mode",
    category: "General",
    scope: "app",
    defaultBinding: "Command+N",
  },
  {
    id: "app.openSettings",
    title: "Open settings",
    description: "Open Mains settings",
    category: "General",
    scope: "app",
    defaultBinding: "Command+Shift+S",
  },
  {
    id: "app.closeSettings",
    title: "Close settings",
    description: "Return from settings to the previous workspace view",
    category: "General",
    scope: "settings",
    defaultBinding: "Command+Shift+W",
  },
  {
    id: "app.focusComposer",
    title: "Focus composer",
    description: "Move keyboard focus to the message composer",
    category: "General",
    scope: "app",
    defaultBinding: "Command+Shift+P",
  },
  {
    id: "app.toggleSidebar",
    title: "Toggle sidebar",
    description: "Show or hide the workspace sidebar",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+Option+S",
  },
  {
    id: "app.toggleTerminal",
    title: "Toggle terminal",
    description: "Show or hide the terminal in Code mode",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+J",
  },
  {
    id: "app.toggleBrowser",
    title: "Toggle browser",
    description: "Show or hide the in-app browser",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+Option+B",
  },
  {
    id: "navigation.code",
    title: "Switch to Code",
    description: "Open the developer experience",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+1",
  },
  {
    id: "navigation.work",
    title: "Switch to Work",
    description: "Open the work experience",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+2",
  },
  {
    id: "navigation.chat",
    title: "Switch to Chat",
    description: "Open the chat experience",
    category: "Navigation",
    scope: "app",
    defaultBinding: "Command+3",
  },
  {
    id: "projects.addLocal",
    title: "Add project from local",
    description: "Add an existing folder from this Mac",
    category: "Projects",
    scope: "app",
    defaultBinding: "Command+Shift+O",
  },
  {
    id: "projects.clone",
    title: "Clone project from URL",
    description: "Clone a remote Git repository",
    category: "Projects",
    scope: "app",
    defaultBinding: "Command+Shift+U",
  },
  {
    id: "projects.create",
    title: "Create new project",
    description: "Create and initialize a new project",
    category: "Projects",
    scope: "app",
    defaultBinding: "Command+Shift+N",
  },
  {
    id: "browser.focusLocation",
    title: "Focus address bar",
    description: "Focus the in-app browser address bar",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+L",
  },
  {
    id: "browser.find",
    title: "Find on page",
    description: "Search within the active browser tab",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+F",
  },
  {
    id: "browser.newTab",
    title: "New browser tab",
    description: "Open a new in-app browser tab",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+T",
  },
  {
    id: "browser.closeTab",
    title: "Close browser tab",
    description: "Close the active in-app browser tab",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+W",
  },
  {
    id: "browser.print",
    title: "Print page",
    description: "Print the active browser page",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+P",
  },
  {
    id: "browser.back",
    title: "Go back",
    description: "Go back in browser history",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+BracketLeft",
  },
  {
    id: "browser.forward",
    title: "Go forward",
    description: "Go forward in browser history",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+BracketRight",
  },
  {
    id: "browser.zoomIn",
    title: "Zoom in",
    description: "Increase the active page zoom",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+Equal",
  },
  {
    id: "browser.zoomOut",
    title: "Zoom out",
    description: "Decrease the active page zoom",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+Minus",
  },
  {
    id: "browser.resetZoom",
    title: "Reset zoom",
    description: "Return the active page to 100% zoom",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Command+0",
  },
  {
    id: "browser.nextTab",
    title: "Next browser tab",
    description: "Activate the next in-app browser tab",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Control+Tab",
  },
  {
    id: "browser.previousTab",
    title: "Previous browser tab",
    description: "Activate the previous in-app browser tab",
    category: "Browser",
    scope: "browser",
    defaultBinding: "Control+Shift+Tab",
  },
  {
    id: "editor.save",
    title: "Save file",
    description: "Save the file open in the code viewer",
    category: "Editor",
    scope: "editor",
    defaultBinding: "Command+S",
  },
  {
    id: "editor.addSelection",
    title: "Add selection to chat",
    description: "Attach the selected code to the composer",
    category: "Editor",
    scope: "editor",
    defaultBinding: "Command+L",
  },
] as const satisfies readonly {
  id: string;
  title: string;
  description: string;
  category: KeyboardShortcutCategory;
  scope: KeyboardShortcutScope;
  defaultBinding: string;
}[];

export type KeyboardShortcutId = (typeof KEYBOARD_SHORTCUTS)[number]["id"];
export type KeyboardShortcutDefinition = (typeof KEYBOARD_SHORTCUTS)[number];
export type KeyboardShortcutOverrides = Partial<
  Record<KeyboardShortcutId, string | null>
>;

const SHORTCUT_BY_ID = new Map<KeyboardShortcutId, KeyboardShortcutDefinition>(
  KEYBOARD_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);
const SHORTCUT_IDS = new Set<string>(SHORTCUT_BY_ID.keys());

const MODIFIER_ORDER = ["Command", "Control", "Option", "Shift"] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIER_ORDER)[number]> = {
  command: "Command",
  cmd: "Command",
  meta: "Command",
  control: "Control",
  ctrl: "Control",
  option: "Option",
  alt: "Option",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  " ": "Space",
  spacebar: "Space",
  esc: "Escape",
  ",": "Comma",
  ".": "Period",
  "[": "BracketLeft",
  "]": "BracketRight",
  "=": "Equal",
  "+": "Equal",
  "-": "Minus",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  space: "Space",
  comma: "Comma",
  period: "Period",
  bracketleft: "BracketLeft",
  bracketright: "BracketRight",
  equal: "Equal",
  minus: "Minus",
  slash: "Slash",
  backslash: "Backslash",
  semicolon: "Semicolon",
  quote: "Quote",
  backquote: "Backquote",
};

const DISPLAY_KEYS: Record<string, string> = {
  Space: "Space",
  Escape: "Esc",
  Enter: "↵",
  Tab: "⇥",
  Backspace: "⌫",
  Delete: "⌦",
  Comma: ",",
  Period: ".",
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "+",
  Minus: "−",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const DISPLAY_MODIFIERS: Record<(typeof MODIFIER_ORDER)[number], string> = {
  Command: "⌘",
  Control: "⌃",
  Option: "⌥",
  Shift: "⇧",
};

const RESERVED_BINDINGS = new Set([
  "Command+Q",
  "Command+H",
  "Command+M",
  "Command+Tab",
  "Command+Shift+Tab",
  "Command+Space",
  "Command+A",
  "Command+C",
  "Command+V",
  "Command+X",
  "Command+Z",
  "Command+Shift+Z",
  "Command+Option+Escape",
  "Command+Control+Q",
]);

function normalizeKeyToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const alias = KEY_ALIASES[value.toLowerCase()];
  if (alias) return alias;
  if (/^Key[A-Z]$/.test(value)) return value.slice(3);
  if (/^Digit[0-9]$/.test(value)) return value.slice(5);
  if (/^[A-Za-z]$/.test(value)) return value.toUpperCase();
  if (/^[0-9]$/.test(value)) return value;
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/i.test(value)) return value.toUpperCase();
  return null;
}

export function normalizeKeyboardShortcut(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const parts = input.split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const modifiers = new Set<(typeof MODIFIER_ORDER)[number]>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier);
      continue;
    }
    if (key) return null;
    key = normalizeKeyToken(part);
    if (!key) return null;
  }
  if (!key) return null;
  const hasPrimaryModifier = ["Command", "Control", "Option"].some(
    (modifier) =>
      modifiers.has(modifier as (typeof MODIFIER_ORDER)[number]),
  );
  if (!hasPrimaryModifier && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return null;
  }
  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
}

export interface KeyboardShortcutInput {
  code?: string;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function keyboardShortcutFromInput(
  input: KeyboardShortcutInput,
): string | null {
  const rawKey = input.code || input.key || "";
  const key = normalizeKeyToken(rawKey);
  if (!key || ["Command", "Control", "Option", "Shift"].includes(key)) {
    return null;
  }
  const parts: string[] = [];
  if (input.metaKey) parts.push("Command");
  if (input.ctrlKey) parts.push("Control");
  if (input.altKey) parts.push("Option");
  // On standard macOS keyboards "+" is Shift+=, but applications conventionally
  // present and bind the zoom chord as Command++. Keep Equal as the canonical
  // physical key without making Shift a second, surprising requirement.
  if (input.shiftKey && key !== "Equal") parts.push("Shift");
  parts.push(key);
  return normalizeKeyboardShortcut(parts.join("+"));
}

export function formatKeyboardShortcut(binding: string | null): string[] {
  if (!binding) return [];
  const normalized = normalizeKeyboardShortcut(binding);
  if (!normalized) return [];
  return normalized.split("+").map((part) => {
    if (part in DISPLAY_MODIFIERS) {
      return DISPLAY_MODIFIERS[part as keyof typeof DISPLAY_MODIFIERS];
    }
    return DISPLAY_KEYS[part] ?? part;
  });
}

export function keyboardShortcutLabel(binding: string | null): string {
  return formatKeyboardShortcut(binding).join("");
}

export function isKeyboardShortcutId(input: string): input is KeyboardShortcutId {
  return SHORTCUT_IDS.has(input);
}

export function getKeyboardShortcutDefinition(
  id: KeyboardShortcutId,
): KeyboardShortcutDefinition {
  return SHORTCUT_BY_ID.get(id)!;
}

export function sanitizeKeyboardShortcutOverrides(
  input: unknown,
): KeyboardShortcutOverrides {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: KeyboardShortcutOverrides = {};
  for (const [id, binding] of Object.entries(input)) {
    if (!isKeyboardShortcutId(id)) continue;
    if (binding === null) {
      output[id] = null;
      continue;
    }
    const normalized = normalizeKeyboardShortcut(binding);
    if (normalized) output[id] = normalized;
  }
  return output;
}

export function parseKeyboardShortcutOverrides(
  input: unknown,
): KeyboardShortcutOverrides {
  if (typeof input !== "string") return sanitizeKeyboardShortcutOverrides(input);
  try {
    return sanitizeKeyboardShortcutOverrides(JSON.parse(input));
  } catch {
    return {};
  }
}

export function resolveKeyboardShortcut(
  id: KeyboardShortcutId,
  overrides: KeyboardShortcutOverrides,
): string | null {
  return Object.prototype.hasOwnProperty.call(overrides, id)
    ? overrides[id] ?? null
    : getKeyboardShortcutDefinition(id).defaultBinding;
}

export function isReservedKeyboardShortcut(binding: string): boolean {
  return RESERVED_BINDINGS.has(binding);
}

function scopesOverlap(
  left: KeyboardShortcutScope,
  right: KeyboardShortcutScope,
): boolean {
  return left === "app" || right === "app" || left === right;
}

export function findKeyboardShortcutConflict(
  id: KeyboardShortcutId,
  binding: string,
  overrides: KeyboardShortcutOverrides,
): KeyboardShortcutDefinition | null {
  const definition = getKeyboardShortcutDefinition(id);
  return (
    KEYBOARD_SHORTCUTS.find(
      (candidate) =>
        candidate.id !== id &&
        scopesOverlap(definition.scope, candidate.scope) &&
        resolveKeyboardShortcut(candidate.id, overrides) === binding,
    ) ?? null
  );
}

export function bindingsForKeyboardShortcuts(
  overrides: KeyboardShortcutOverrides,
): Record<KeyboardShortcutId, string | null> {
  return Object.fromEntries(
    KEYBOARD_SHORTCUTS.map((shortcut) => [
      shortcut.id,
      resolveKeyboardShortcut(shortcut.id, overrides),
    ]),
  ) as Record<KeyboardShortcutId, string | null>;
}

export function matchesKeyboardShortcut(
  input: KeyboardShortcutInput,
  binding: string | null,
): boolean {
  return binding !== null && keyboardShortcutFromInput(input) === binding;
}
