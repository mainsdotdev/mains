export const DEFAULT_APPSHOT_SHORTCUT = "Command+Shift+Space";

export const APPSHOT_SHORTCUTS = [
  DEFAULT_APPSHOT_SHORTCUT,
  "Command+Shift+A",
  "Command+Option+Space",
] as const;

export type AppshotShortcut = (typeof APPSHOT_SHORTCUTS)[number];

export type AppshotScreenPermission =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export type AppshotAccessibilityStatus =
  | "captured"
  | "permission-denied"
  | "unavailable";

export interface AppshotCapture {
  id: string;
  appName: string;
  bundleIdentifier: string | null;
  windowTitle: string;
  timestamp: string;
  screenshotPath: string;
  screenshotCaptureName: string;
  screenshotMimeType: "image/png";
  accessibilityText: string;
  accessibilityStatus: AppshotAccessibilityStatus;
  accessibilityTruncated: boolean;
}

export interface AppshotsStatus {
  supported: boolean;
  enabled: boolean;
  shortcut: AppshotShortcut;
  shortcutRegistered: boolean;
  screenPermission: AppshotScreenPermission;
  accessibilityTrusted: boolean;
  capturing: boolean;
  lastError: string | null;
}

export interface AppshotsConfiguration {
  enabled: boolean;
  shortcut: AppshotShortcut;
}

export type AppshotsSystemSettingsPane =
  | "screen-recording"
  | "accessibility"
  | "automation";
