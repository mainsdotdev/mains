import {
  APPSHOT_SHORTCUTS,
  type AppshotShortcut,
  type AppshotsConfiguration,
  type AppshotsSystemSettingsPane,
} from "../../../shared/appshots";

const SHORTCUTS = new Set<string>(APPSHOT_SHORTCUTS);
const SETTINGS_PANES = new Set<AppshotsSystemSettingsPane>([
  "screen-recording",
  "accessibility",
  "automation",
]);

export function requireAppshotsConfiguration(
  input: unknown,
): AppshotsConfiguration {
  if (!input || typeof input !== "object") {
    throw new Error("Lens configuration must be an object");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  if (typeof value.shortcut !== "string" || !SHORTCUTS.has(value.shortcut)) {
    throw new Error("Unsupported Lens shortcut");
  }
  return {
    enabled: value.enabled,
    shortcut: value.shortcut as AppshotShortcut,
  };
}

export function normalizedAppshotShortcut(input: unknown): AppshotShortcut {
  return typeof input === "string" && SHORTCUTS.has(input)
    ? (input as AppshotShortcut)
    : APPSHOT_SHORTCUTS[0];
}

export function requireCaptureName(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^appshot-[a-z0-9-]+\.png$/i.test(input)
  ) {
    throw new Error("Invalid Lens capture name");
  }
  return input;
}

export function requireCaptureId(input: unknown): string {
  if (typeof input !== "string" || input.length < 8 || input.length > 100) {
    throw new Error("Invalid Lens capture id");
  }
  return input;
}

export function requireSystemSettingsPane(
  input: unknown,
): AppshotsSystemSettingsPane {
  if (typeof input !== "string" || !SETTINGS_PANES.has(input as AppshotsSystemSettingsPane)) {
    throw new Error("Invalid system settings pane");
  }
  return input as AppshotsSystemSettingsPane;
}
